import type { Bar } from './relay.ts'
import type { SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { createRelay } from './relay.ts'

function slide(no: number, chapter: string | null, extra: Partial<SlideInfo> = {}): SlideInfo {
  return { no, title: null, chapter, chapterNo: null, progress: null, activity: null, timer: null, screen: null, until: null, text: null, ...extra }
}

interface Drawn { id: string, text?: string }

/* A bar that records calls; `fail` makes it unreachable. */
function fakeBar() {
  const calls: string[] = []
  const drawn: Drawn[] = []
  const leds: (string | undefined)[] = []
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
    async AudioPlay() {
      state.sounds++
      return { result: 'OK' }
    },
  }
  const last = (id: string) => drawn.findLast(e => e.id === id)
  return { bar, calls, leds, state, last }
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

test('a relay that showed nothing clears nothing on exit (slidev export)', async () => {
  const { bar, calls } = fakeBar()
  await createRelay(bar, fakeLog()).close()
  assert.deepEqual(calls, [])
})

/* Timers: simulated clock and timers. */
function timed() {
  let clock = 0
  const fake = fakeBar()
  const relay = createRelay(fake.bar, fakeLog(), { now: () => clock })
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

const workshop = slide(4, 'Hooks', { activity: 'Workshop 1', timer: '2m' })

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
