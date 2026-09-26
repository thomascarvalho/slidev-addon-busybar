import type { RenderState } from './render.ts'
import type { Timer } from './timer.ts'
import type { Schedule } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from './config.ts'
import { renderBack } from './render-back.ts'
import { EMPTY_DAY, enter } from './schedule.ts'

const MIN = 60_000
const at = (h: number, m: number, s = 0) => new Date(2026, 8, 26, h, m, s).getTime()

const deck: Schedule = {
  start: 9 * 60,
  end: 17 * 60,
  warnings: [],
  steps: [
    { from: 2, kind: 'chapter', label: 'Hooks', durationMs: 45 * MIN, at: null },
    { from: 6, kind: 'break', label: null, durationMs: 15 * MIN, at: null },
    { from: 7, kind: 'chapter', label: 'Référencer du code et sécuriser', durationMs: 60 * MIN, at: null },
    { from: 12, kind: 'break', label: 'Déjeuner', durationMs: 60 * MIN, at: 12 * 60 + 30 },
  ],
}

const config = resolveConfig({ locale: 'fr' })
const byId = (elements: { id: string }[], id: string) => elements.find(e => e.id === id) as Record<string, unknown> | undefined
const state = (extra: Partial<RenderState>): RenderState => ({ slide: null, timer: null, setting: null, schedule: null, day: EMPTY_DAY, ...extra })
const running = (leftMs: number, now: number): Timer => ({ label: 'Workshop 1', style: null, phases: [{ label: null, ms: 15 * MIN }], index: 0, totalMs: 15 * MIN, endsAt: now + leftMs, leftMs: 0, rang: false, warned: false })
/* Home-made digits are pixel art: the XPM header gives their size, the
   palette their colour. */
const shows = (e: Record<string, unknown> | undefined, text: string, scale: number) => e !== undefined && String(e.data).startsWith(`! XPM2\n${(text.length * 4 - 1) * scale} ${5 * scale} `)
const colourOf = (e: Record<string, unknown> | undefined) => /# c (#[0-9A-F]{6})/.exec(String(e?.data))?.[1]

test('every element is on the back, ids prefixed', () => {
  const { elements } = renderBack(state({ schedule: deck }), at(10, 52), config)
  assert.ok(elements.length > 0)
  for (const e of elements) {
    assert.equal((e as { display?: string }).display, 'back', e.id)
    assert.match(e.id, /^back:/)
  }
})

test('without a schedule: the clock in big digits, the rules, nothing else', () => {
  const { elements, nextAt } = renderBack(state({}), at(10, 52, 30), config)
  const clock = byId(elements, 'back:clock')!
  assert.ok(shows(clock, '10:52', 4), 'five characters at scale 4')
  assert.equal(clock.x, 4)
  assert.deepEqual(elements.map(e => e.id).sort(), ['back:clock', 'back:rule1', 'back:rule2'])
  assert.equal(nextAt, at(10, 53), 'refreshed at the top of the minute')
})

test('nothing is drawn under the firmware\'s status column (x ≥ 148)', () => {
  const day = enter(deck, EMPTY_DAY, 0, at(9, 12))
  const { elements } = renderBack(state({ schedule: deck, day, timer: running(754_000, at(9, 24)) }), at(9, 24), config)
  for (const e of elements as Record<string, unknown>[]) {
    const right = e.align === 'top_right' ? Number(e.x) : Number(e.x) + Number(e.width ?? 0)
    assert.ok(right <= 148, `${e.id} reaches ${right}`)
  }
})

test('before the first step: the clock, no delay, the first step next', () => {
  const { elements } = renderBack(state({ schedule: deck }), at(8, 50), config)
  assert.equal(byId(elements, 'back:delay'), undefined)
  assert.equal(byId(elements, 'back:step'), undefined)
  assert.equal(byId(elements, 'back:next-title')!.text, 'SUITE')
  assert.equal(byId(elements, 'back:next')!.text, 'Hooks')
  assert.equal(byId(elements, 'back:next-time')!.text, '09:00')
})

test('the current chapter: delay, name, time left, progress', () => {
  /* Hooks entered 09:12 (planned 09:00–09:45): 12 late, 33 min left at 09:24. */
  const day = enter(deck, EMPTY_DAY, 0, at(9, 12))
  const { elements } = renderBack(state({ schedule: deck, day }), at(9, 24), config)
  const delay = byId(elements, 'back:delay')!
  assert.ok(shows(delay, '+12', 3))
  assert.equal(colourOf(delay), '#FFFFFF')
  assert.equal(delay.x, 148 - 33, 'right-aligned on the usable edge')
  assert.equal(byId(elements, 'back:delay-label')!.text, 'retard')
  assert.equal(byId(elements, 'back:step-title')!.text, 'CHAPITRE')
  assert.equal(byId(elements, 'back:step')!.text, 'Hooks')
  assert.equal(byId(elements, 'back:step')!.align, 'top_left')
  assert.equal(byId(elements, 'back:step-left')!.text, '33 min')
  const fill = byId(elements, 'back:step-fill')!
  assert.equal(fill.width, Math.round(144 * 12 / 45))
  assert.equal(byId(elements, 'back:next')!.text, 'Pause', 'an unnamed break is named after its screen')
  assert.equal(byId(elements, 'back:next-time')!.text, '09:45')
})

test('on time: a grey 0 without a label; early: "avance"', () => {
  const day = enter(deck, EMPTY_DAY, 0, at(9, 0))
  const onTime = renderBack(state({ schedule: deck, day }), at(9, 10), config).elements
  assert.ok(shows(byId(onTime, 'back:delay'), '0', 3))
  assert.equal(colourOf(byId(onTime, 'back:delay')), '#8A8A8A')
  assert.equal(byId(onTime, 'back:delay-label'), undefined)
  const early = renderBack(state({ schedule: deck, day: enter(deck, EMPTY_DAY, 0, at(8, 55)) }), at(9, 0), config).elements
  assert.ok(shows(byId(early, 'back:delay'), '-5', 3))
  assert.equal(byId(early, 'back:delay-label')!.text, 'avance')
})

test('overrun: the time left goes negative in grey, the progress line is full', () => {
  const day = enter(deck, EMPTY_DAY, 0, at(9, 0))
  const { elements } = renderBack(state({ schedule: deck, day }), at(9, 50), config)
  assert.equal(byId(elements, 'back:step-left')!.text, '-5 min')
  assert.equal(byId(elements, 'back:step-left')!.color, '#8A8A8AFF')
  assert.equal(byId(elements, 'back:step-fill')!.width, 144)
})

test('a long step name scrolls within the room left of the time', () => {
  const day = enter(deck, EMPTY_DAY, 2, at(10, 0))
  const { elements } = renderBack(state({ schedule: deck, day }), at(10, 10), config)
  const step = byId(elements, 'back:step')!
  assert.equal(step.text, 'Référencer du code et sécuriser')
  assert.ok(Number(step.scroll_rate) > 0)
  assert.ok(Number(step.width) < 144)
  assert.equal(byId(elements, 'back:next')!.text, 'Déjeuner')
  assert.equal(byId(elements, 'back:next-time')!.text, '12:30')
})

test('a break step has no chapter caption', () => {
  const day = enter(deck, EMPTY_DAY, 1, at(9, 45))
  const { elements } = renderBack(state({ schedule: deck, day }), at(9, 50), config)
  assert.equal(byId(elements, 'back:step-title'), undefined)
  assert.equal(byId(elements, 'back:step')!.text, 'Pause')
})

test('after the last step: the end of the day', () => {
  const day = enter(deck, EMPTY_DAY, 3, at(12, 30))
  const { elements } = renderBack(state({ schedule: deck, day }), at(12, 40), config)
  assert.equal(byId(elements, 'back:next')!.text, 'Fin')
  assert.equal(byId(elements, 'back:next-time')!.text, '17:00')
  const noEnd = renderBack(state({ schedule: { ...deck, end: null }, day }), at(12, 40), config).elements
  assert.equal(byId(noEnd, 'back:next'), undefined)
})

test('a timer in progress takes the middle band: running, paused, waiting, finished', () => {
  const now = at(10, 0)
  const day = enter(deck, EMPTY_DAY, 0, at(9, 0))
  const run = renderBack(state({ schedule: deck, day, timer: running(754_000, now) }), now, config).elements
  assert.equal(byId(run, 'back:step'), undefined, 'the chapter band gives way')
  assert.equal(byId(run, 'back:timer')!.text, 'Workshop 1')
  assert.ok(shows(byId(run, 'back:timer-value'), '12:34', 3))
  assert.equal(colourOf(byId(run, 'back:timer-value')), '#FFFFFF')
  assert.equal(byId(run, 'back:timer-fill')!.width, Math.round(144 * 754_000 / (15 * MIN)))
  assert.equal(byId(run, 'back:next')!.text, 'Pause', 'the next band stays')

  const paused = renderBack(state({ timer: { ...running(754_000, now), endsAt: null, leftMs: 754_000 } }), now, config).elements
  assert.equal(colourOf(byId(paused, 'back:timer-value')), '#8A8A8A')

  const lab: Timer = { ...running(0, now), label: 'Lab', phases: [{ label: 'Reading', ms: 5 * MIN }, { label: 'Coding', ms: 10 * MIN }], index: 0, totalMs: 5 * MIN, endsAt: now - 1000 }
  const waiting = renderBack(state({ timer: lab }), now, config).elements
  assert.equal(byId(waiting, 'back:timer')!.text, 'Suivant Coding')
  assert.ok(shows(byId(waiting, 'back:timer-value'), '10:00', 3))
  assert.ok(byId(waiting, 'back:timer-seg0'), 'the done phase is drawn')

  const finished = renderBack(state({ timer: running(-5000, now) }), now - (now % 1000), config).elements
  assert.equal(byId(finished, 'back:timer')!.text, 'Temps écoulé')
  assert.equal(byId(finished, 'back:timer')!.color, '#FFFFFFFF')
  const dark = renderBack(state({ timer: running(-5000, now) }), now - (now % 1000) + 500, config).elements
  assert.equal(byId(dark, 'back:timer')!.color, '#404040FF')
})
