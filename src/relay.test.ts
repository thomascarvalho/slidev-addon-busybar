import type { Bar, RelayOptions } from './relay.ts'
import type { Sound } from './sounds.ts'
import type { SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { resolveConfig } from './config.ts'
import { createRelay } from './relay.ts'
import { stockPlayer } from './sounds.ts'

function slide(no: number, chapter: string | null, extra: Partial<SlideInfo> = {}): SlideInfo {
  return { no, title: null, chapter, chapterNo: null, progress: null, activity: null, timer: null, screen: null, until: null, text: null, sound: null, ...extra }
}

interface Drawn { id: string, text?: string }

/* A bar that records calls; `fail` makes it unreachable. */
function fakeBar() {
  const calls: string[] = []
  const drawn: Drawn[] = []
  const leds: (string | undefined)[] = []
  const played: string[] = []
  const state = { fail: null as null | { status?: number, name?: string, message: string }, sounds: 0 }
  const bar: Bar = {
    async DisplayDraw(params) {
      if (state.fail)
        throw state.fail
      calls.push(`draw ${params.elements.map(e => e.id).join(',')}`)
      drawn.push(...params.elements as Drawn[])
      leds.push(params.led_notification_color)
      return { result: 'OK' }
    },
    async DisplayClear(params) {
      if (state.fail)
        throw state.fail
      calls.push(params?.element_ids ? `clear ${params.element_ids.join(',')}` : 'clear all')
      return { result: 'OK' }
    },
    async AudioPlay(params) {
      state.sounds++
      played.push('stock_path' in params ? params.stock_path : params.path)
      return { result: 'OK' }
    },
  }
  const last = (id: string) => drawn.findLast(e => e.id === id)
  return { bar, calls, leds, played, state, last }
}

function fakeLog() {
  const lines: string[] = []
  return { lines, info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('draws the chapter title after clearing what a previous server left', async () => {
  const { bar, calls } = fakeBar()
  const relay = createRelay(bar, fakeLog())
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  assert.deepEqual(calls, ['clear all', 'draw title'])
})

test('ignores a payload identical to the last one (audience + presenter)', async () => {
  const { bar, calls } = fakeBar()
  const relay = createRelay(bar, fakeLog())
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  assert.deepEqual(calls, ['clear all', 'draw title'])
})

test('does not redraw an unchanged element, clears the ones that go away', async () => {
  const { bar, calls } = fakeBar()
  const relay = createRelay(bar, fakeLog())
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  relay.setSlide(slide(3, 'Hooks'))
  await settle()
  relay.setSlide(slide(1, null))
  await settle()
  assert.deepEqual(calls, ['clear all', 'draw title', 'clear title'])
})

test('unreachable bar: one warning, everything redrawn when it comes back', async () => {
  const { bar, calls, state } = fakeBar()
  const log = fakeLog()
  const relay = createRelay(bar, log)
  state.fail = { name: 'TypeError', message: 'fetch failed' }
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  relay.setSlide(slide(5, 'Effects'))
  await settle()
  assert.equal(log.lines.filter(l => l.startsWith('warn')).length, 1)

  state.fail = null
  await relay.flush()
  assert.deepEqual(calls, ['clear all', 'draw title'])
  assert.match(log.lines.at(-1)!, /reachable again/)
  await relay.close()
})

test('a 409 says what to do', async () => {
  const { bar, state } = fakeBar()
  const log = fakeLog()
  const relay = createRelay(bar, log)
  state.fail = { status: 409, message: 'Not drawn due to low priority' }
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  assert.match(log.lines[0], /APPS/)
  await relay.close()
})

test('redraw draws everything again at once, even an unchanged screen', async () => {
  const { bar, calls } = fakeBar()
  const relay = createRelay(bar, fakeLog())
  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  relay.redraw()
  await settle()
  assert.deepEqual(calls, ['clear all', 'draw title', 'clear all', 'draw title'])
  await relay.close()
})

test('a relay that showed nothing clears nothing on exit (slidev export)', async () => {
  const { bar, calls } = fakeBar()
  await createRelay(bar, fakeLog()).close()
  assert.deepEqual(calls, [])
})

/* Timers: simulated clock and timers. */
function timed(options: Partial<RelayOptions> = {}) {
  let clock = 0
  const fake = fakeBar()
  const relay = createRelay(fake.bar, fakeLog(), { now: () => clock, ...options })
  return {
    ...fake,
    relay,
    async advance(ms: number) {
      clock += ms
      mock.timers.tick(ms)
      await settle()
      await settle()
    },
  }
}

const workshop = slide(4, 'Hooks', { activity: 'Workshop 1', timer: ['2m'] })

test('the timer starts on the shortcut only, then survives going back', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const { relay, last, advance } = timed()

  relay.setSlide(workshop)
  await settle()
  await advance(30_000)
  assert.equal(last('value')?.text, '2:00', 'not started on its own')

  relay.timer('toggle')
  await settle()
  await advance(30_000)
  assert.equal(last('value')?.text, '1:30')

  relay.setSlide(slide(2, 'Hooks'))
  await settle()
  await advance(1010)
  assert.equal(last('value')?.text, '1:29', 'still shown on another slide')
  await relay.close()
})

test('at zero: one sound, red LED, "Time\'s up" acknowledged by changing slide', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const { relay, last, leds, state, advance } = timed()

  relay.setSlide(workshop)
  relay.timer('toggle')
  await settle()
  for (let s = 0; s < 125; s++)
    await advance(1000)
  assert.equal(state.sounds, 1)
  assert.equal(last('title')?.text, 'Time\'s up')
  assert.equal(leds.at(-1), '#FF3030FF')

  relay.setSlide(slide(5, 'Hooks'))
  await settle()
  await advance(1000)
  assert.equal(last('title')?.text, 'Hooks')
  assert.equal(leds.at(-1), undefined, 'the LED stops')
  await relay.close()
})

test('an element that changes kind is cleared before being drawn again', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const { relay, calls, advance } = timed()

  relay.setSlide(slide(4, 'Hooks', { activity: 'Quiz', timer: ['1m'] }))
  relay.timer('toggle')
  await settle()
  await advance(61_000)
  /* The gradient fill of the running timer becomes the solid fill of
     "Time's up": the bar would keep the gradient if it were not cleared. */
  const turn = calls.findIndex(c => c.startsWith('clear') && c.includes('fill'))
  assert.ok(turn > 0, calls.join(' | '))
  assert.match(calls[turn + 1], /^draw .*fill/)
  await relay.close()
})

test('a break warns once in its last minute, then rings at zero', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(6, null, { screen: 'break', timer: ['2m'] }))
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 58; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, [], 'not yet')
  for (let s = 0; s < 5; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['shared/volume_change.snd'])
  for (let s = 0; s < 62; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['shared/volume_change.snd', 'shared/calendar_reminder_ends.snd'])
  await fake.relay.close()
})

test('an activity never warns', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(workshop)
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 125; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['shared/calendar_reminder_ends.snd'])
  await fake.relay.close()
})

test('a break slide waits for a workshop still going: pause, cancel, then start the break', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed({ config: resolveConfig({ sounds: { start: 'volume_change' } }) })

  fake.relay.setSlide(workshop)
  fake.relay.timer('toggle')
  await settle()
  await fake.advance(30_000)
  assert.equal(fake.last('value')?.text, '1:30', 'the workshop counts down')

  fake.relay.setSlide(slide(6, null, { screen: 'break', timer: ['15m'] }))
  await settle()
  assert.equal(fake.last('value')?.text, '1:30', 'the bar still shows the workshop')

  fake.relay.timer('toggle')
  await settle()
  await fake.advance(30_000)
  assert.equal(fake.last('value')?.text, '1:30', 'paused: value frozen')

  fake.relay.timer('cancel')
  await settle()
  fake.relay.timer('toggle')
  await settle()
  assert.equal(fake.last('value')?.text, '15:00', 'the break starts')
  assert.deepEqual(fake.played, ['shared/volume_change.snd', 'shared/volume_change.snd'], 'the start sound plays again for the break')
  await fake.relay.close()
})

test('each phase ends with the sound, a waiting workshop survives slide changes', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(4, 'Hooks', { activity: 'Lab', timer: ['1m Reading', '1m Coding'] }))
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 62; s++)
    await fake.advance(1000)
  assert.equal(fake.state.sounds, 1)
  assert.equal(fake.last('label')?.text, 'Next Coding')

  fake.relay.setSlide(slide(5, 'Hooks'))
  await settle()
  await fake.advance(1000)
  assert.equal(fake.last('label')?.text, 'Next Coding', 'still waiting on another slide')

  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 62; s++)
    await fake.advance(1000)
  assert.equal(fake.state.sounds, 2)
  assert.equal(fake.last('title')?.text, 'Time\'s up')
  await fake.relay.close()
})

test('each moment plays its own sound from the config', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const config = resolveConfig({ sounds: { timeUp: 'calendar_event_starts', phaseEnd: 'volume_change', start: 'calendar_reminder_ends' } })
  const fake = timed({ config })
  fake.relay.setSlide(slide(4, 'Hooks', { activity: 'Lab', timer: ['1m A', '1m B'] }))
  fake.relay.timer('toggle')
  await settle()
  assert.deepEqual(fake.played, ['shared/calendar_reminder_ends.snd'], 'start')
  for (let s = 0; s < 62; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played.slice(1), ['shared/volume_change.snd'], 'phase end')
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 62; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played.slice(2), ['shared/calendar_reminder_ends.snd', 'shared/calendar_event_starts.snd'], 'start of B, then time up')
  await fake.relay.close()
})

test('resuming a paused timer does not play the start sound', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed({ config: resolveConfig({ sounds: { start: 'volume_change' } }) })
  fake.relay.setSlide(workshop)
  fake.relay.timer('toggle')
  fake.relay.timer('toggle')
  fake.relay.timer('toggle')
  await settle()
  assert.deepEqual(fake.played, ['shared/volume_change.snd'])
  await fake.relay.close()
})

test('a slide\'s sound replaces the end sound only, false silences it', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(6, null, { screen: 'break', timer: ['2m'], sound: 'calendar_event_starts' }))
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 125; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['shared/volume_change.snd', 'shared/calendar_event_starts.snd'], 'warning unchanged, end replaced')

  const quiet = timed()
  quiet.relay.setSlide(slide(4, 'Hooks', { activity: 'Quiz', timer: ['1m'], sound: false }))
  quiet.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 62; s++)
    await quiet.advance(1000)
  assert.deepEqual(quiet.played, [])
  await fake.relay.close()
  await quiet.relay.close()
})

test('a file sound plays through the player once it is ready', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const sounds = { resolve: (sound: Sound, fallback: Sound) => sound && 'file' in sound ? { application_name: 'slidev', path: 'sounds/abc.snd' } : stockPlayer.resolve(sound, fallback) }
  const fake = timed({ sounds, config: resolveConfig({ sounds: { timeUp: './gong.wav' } }) })
  fake.relay.setSlide(workshop)
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 125; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['sounds/abc.snd'])
  await fake.relay.close()
})

test('the setting opens at 5 min, follows the wheel within 1..120 min, and starts a timer', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed({ config: resolveConfig({ sounds: { start: 'volume_change' } }) })
  fake.relay.setSlide(slide(2, 'Hooks'))
  fake.relay.openSetting()
  await settle()
  assert.equal(fake.relay.setting(), true)
  assert.equal(fake.last('value')?.text, '5:00')
  for (let i = 0; i < 7; i++)
    fake.relay.adjust(-1)
  await settle()
  assert.equal(fake.last('value')?.text, '1:00', 'not below one minute')
  fake.relay.adjust(2)
  fake.relay.startSetting()
  await settle()
  assert.equal(fake.relay.setting(), false)
  assert.deepEqual(fake.played, ['shared/volume_change.snd'])
  await fake.advance(1010)
  assert.equal(fake.last('value')?.text, '2:59')
  fake.relay.timer('cancel')
  fake.relay.openSetting()
  await settle()
  assert.equal(fake.last('value')?.text, '3:00', 'the last duration set')
  await fake.relay.close()
})

test('the setting closes on request or after 15 s untouched', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(2, 'Hooks'))
  fake.relay.openSetting()
  fake.relay.closeSetting()
  await settle()
  assert.equal(fake.relay.setting(), false)
  assert.equal(fake.last('title')?.text, 'Hooks')
  fake.relay.openSetting()
  await fake.advance(10_000)
  fake.relay.adjust(1)
  await fake.advance(10_000)
  assert.equal(fake.relay.setting(), true, 'touching it restarts the 15 s')
  await fake.advance(6_000)
  assert.equal(fake.relay.setting(), false)
  assert.equal(fake.last('title')?.text, 'Hooks')
  await fake.relay.close()
})

test('adjust clamps at two hours', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(2, 'Hooks'))
  fake.relay.openSetting()
  fake.relay.adjust(200)
  await settle()
  assert.equal(fake.last('value')?.text, '2:00:00')
  await fake.relay.close()
})

test('setting() honours the expiry directly, without waiting for flush (bar failing)', async (t) => {
  let clock = 0
  const { bar, state } = fakeBar()
  state.fail = { name: 'TypeError', message: 'fetch failed' }
  const relay = createRelay(bar, fakeLog(), { now: () => clock })
  t.after(() => relay.close())
  relay.setSlide(slide(2, 'Hooks'))
  relay.openSetting()
  await settle()
  assert.equal(relay.setting(), true, 'not expired yet')
  clock = 16_000
  /* No flush() ran in between: the bar keeps failing and nothing ticked. */
  assert.equal(relay.setting(), false)
})

test('a timer finishing while the setting is open still rings on time, "Time\'s up" once the setting expires', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed()
  fake.relay.setSlide(slide(4, 'Hooks', { activity: 'Quiz', timer: ['10s'] }))
  fake.relay.timer('toggle')
  await settle()
  fake.relay.openSetting()
  await settle()
  assert.equal(fake.last('label')?.text, 'Timer', 'the setting hides the timer')

  await fake.advance(10_000)
  assert.equal(fake.state.sounds, 1, 'the end sound rings on time, even hidden')
  assert.equal(fake.last('label')?.text, 'Timer', 'still hidden behind the setting')

  await fake.advance(5_000)
  assert.equal(fake.relay.setting(), false, 'the setting has expired')
  assert.equal(fake.last('title')?.text, 'Time\'s up')
  assert.equal(fake.leds.at(-1), '#FF3030FF')
  await fake.relay.close()
})

test('the setting, started, replaces a running workshop and plays the start sound', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const fake = timed({ config: resolveConfig({ sounds: { start: 'volume_change' } }) })
  fake.relay.setSlide(workshop)
  fake.relay.timer('toggle')
  await settle()
  await fake.advance(30_000)
  assert.equal(fake.last('value')?.text, '1:30', 'the workshop counts down')

  fake.relay.openSetting()
  fake.relay.adjust(2)
  fake.relay.startSetting()
  await settle()
  assert.equal(fake.relay.setting(), false)
  assert.equal(fake.last('value')?.text, '7:00', 'the set duration replaces the workshop')
  assert.deepEqual(fake.played, ['shared/volume_change.snd', 'shared/volume_change.snd'], 'start plays again for the ad-hoc timer')
  await fake.relay.close()
})

test('a break ending plays sounds.breakOver from the config, not timeUp', async (t) => {
  t.after(() => mock.timers.reset())
  mock.timers.enable({ apis: ['setTimeout'] })
  const config = resolveConfig({ sounds: { breakOver: 'calendar_event_starts' } })
  const fake = timed({ config })
  fake.relay.setSlide(slide(6, null, { screen: 'break', timer: ['2m'] }))
  fake.relay.timer('toggle')
  await settle()
  for (let s = 0; s < 125; s++)
    await fake.advance(1000)
  assert.deepEqual(fake.played, ['shared/volume_change.snd', 'shared/calendar_event_starts.snd'], 'the warning, then the configured breakOver sound')
  await fake.relay.close()
})

