import type { DayStore } from './day.ts'
import type { Day } from './schedule.ts'
import type { Schedule, SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDayTracker } from './day.ts'

const MIN = 60_000
const at = (h: number, m: number, s = 0) => new Date(2026, 8, 26, h, m, s).getTime()
const slide = (no: number): SlideInfo => ({ no, title: null, chapter: null, chapterNo: null, progress: null, activity: null, timer: null, screen: null, until: null, text: null, sound: null })
const deck: Schedule = {
  start: 9 * 60,
  end: 17 * 60,
  warnings: [],
  steps: [
    { from: 2, kind: 'chapter', label: 'Hooks', durationMs: 45 * MIN, at: null },
    { from: 6, kind: 'chapter', label: 'Effects', durationMs: 60 * MIN, at: null },
  ],
}

/** A tracker with a fake clock, hand-fired grace timers and a recording store. */
function tracker(start = at(9, 0), options: { store?: DayStore } = {}) {
  let clock = start
  const timers: { fn: () => void, ms: number }[] = []
  const changes: Day[] = []
  const days = createDayTracker({
    now: () => clock,
    timers: {
      setTimeout: (fn, ms) => {
        const handle = { fn, ms }
        timers.push(handle)
        return handle
      },
      clearTimeout: (handle) => {
        const i = timers.indexOf(handle as { fn: () => void, ms: number })
        if (i >= 0)
          timers.splice(i, 1)
      },
    },
    grace: () => 10_000,
    onChange: day => changes.push(day),
    ...options,
  })
  return { days, timers, changes, set: (ms: number) => void (clock = ms), fire: () => timers.splice(0).forEach(t => t.fn()) }
}

test('starts empty, or from the store', () => {
  assert.deepEqual(tracker().days.day, { startedAt: null, entered: {} })
  const loaded = { startedAt: at(9, 0), entered: { 'chapter:Hooks': at(9, 12) } }
  assert.deepEqual(tracker(at(9, 20), { store: { load: () => loaded, save: () => {} } }).days.day, loaded)
})

test('a step is entered after the grace on one of its slides, at the time the slide was reached', () => {
  const { days, timers, changes, set, fire } = tracker()
  days.setSchedule(deck)
  days.setSlide(slide(2))
  assert.equal(timers[0]?.ms, 10_000, 'grace armed')
  days.setSlide(slide(1))
  assert.equal(timers.length, 0, 'back before the grace: nothing')
  set(at(9, 12))
  days.setSlide(slide(2))
  set(at(9, 12, 10))
  fire()
  assert.deepEqual(changes, [{ startedAt: at(9, 0), entered: { 'chapter:Hooks': at(9, 12) } }])
  assert.equal(days.day, changes[0])
})

test('the schedule may arrive after the slide, and a new schedule re-arms the grace', () => {
  const { days, timers } = tracker()
  days.setSlide(slide(2))
  assert.equal(timers.length, 0)
  days.setSchedule(deck)
  assert.equal(timers.length, 1)
  days.setSchedule({ ...deck, steps: [deck.steps[1]] })
  assert.equal(timers.length, 0, 'slide 2 belongs to no step of the new schedule')
})

test('start: only before any step, with a schedule that has steps', () => {
  const { days, changes, set } = tracker()
  assert.equal(days.start(), false, 'no schedule')
  days.setSchedule({ ...deck, steps: [] })
  assert.equal(days.start(), false, 'no steps')
  days.setSchedule(deck)
  set(at(9, 10))
  assert.equal(days.start(), true)
  assert.equal(days.day.startedAt, at(9, 10))
  assert.equal(days.start(), true, 'again before any step: moves the start')
  days.setSlide(slide(2))
  set(at(9, 11))
  assert.equal(changes.length, 2)
})

test('reset: only on a slide before the first step, when there is a day to forget', () => {
  const store = { load: () => ({ startedAt: at(8, 0), entered: { 'chapter:Hooks': at(8, 5) } }), save: () => {} }
  const { days, changes } = tracker(at(9, 0), { store })
  days.setSchedule(deck)
  days.setSlide(slide(2))
  assert.equal(days.reset(), false, 'on a step\'s slide')
  days.setSlide(slide(1))
  assert.equal(days.reset(), true)
  assert.deepEqual(days.day, { startedAt: null, entered: {} })
  assert.equal(days.reset(), false, 'nothing left to forget')
  assert.equal(changes.length, 1)
})

test('every change is saved; close drops a pending grace', () => {
  const saved: Day[] = []
  const { days, timers, set, fire } = tracker(at(9, 0), { store: { load: () => null, save: d => void saved.push(d) } })
  days.setSchedule(deck)
  set(at(9, 10))
  days.start()
  assert.equal(saved.length, 1)
  days.setSlide(slide(2))
  days.close()
  assert.equal(timers.length, 0)
  fire()
  assert.equal(saved.length, 1)
})
