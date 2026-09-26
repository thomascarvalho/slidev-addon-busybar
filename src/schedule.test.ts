import type { Schedule } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockMs, current, EMPTY_DAY, enter, minutesOfDay, origin, plan, resumeTime, startDay, status, stepKeys, stepOf } from './schedule.ts'

const MIN = 60_000
/* Local times of one day: the schedule and the clock share the timezone. */
const at = (h: number, m: number, s = 0) => new Date(2026, 8, 26, h, m, s).getTime()

/* 09:00 Hooks 45 min · Break 15 min · Effects 60 min · Lunch 12:30 1 h · Rendering 13:30 60 min · end 17:00 */
const deck: Schedule = {
  start: 9 * 60,
  end: 17 * 60,
  warnings: [],
  steps: [
    { from: 2, kind: 'chapter', label: 'Hooks', durationMs: 45 * MIN, at: null },
    { from: 6, kind: 'break', label: null, durationMs: 15 * MIN, at: null },
    { from: 7, kind: 'chapter', label: 'Effects', durationMs: 60 * MIN, at: null },
    { from: 12, kind: 'break', label: 'Déjeuner', durationMs: 60 * MIN, at: 12 * 60 + 30 },
    { from: 13, kind: 'chapter', label: 'Rendering', durationMs: 60 * MIN, at: 13 * 60 + 30 },
  ],
}

test('clock helpers work in local time', () => {
  assert.equal(clockMs(10 * 60 + 45, at(15, 0)), at(10, 45))
  assert.equal(minutesOfDay(at(10, 52, 30)), 10 * 60 + 52.5)
})

test('planned times chain from the origin; anchors as written', () => {
  const planned = plan(deck, at(9, 0))
  assert.deepEqual(planned.map(p => [p.startsAt, p.endsAt]), [
    [at(9, 0), at(9, 45)],
    [at(9, 45), at(10, 0)],
    [at(10, 0), at(11, 0)],
    [at(12, 30), at(13, 30)],
    [at(13, 30), at(14, 30)],
  ])
})

test('an anchor earlier than the previous end is honoured as written', () => {
  const early: Schedule = { ...deck, steps: [deck.steps[0], { ...deck.steps[2], at: 9 * 60 + 30 }] }
  const planned = plan(early, at(9, 0))
  assert.deepEqual(planned.map(p => [p.startsAt, p.endsAt]), [[at(9, 0), at(9, 45)], [at(9, 30), at(10, 30)]])
})

test('the step of a slide is the last one starting at or before it', () => {
  assert.equal(stepOf(deck, 1), -1)
  assert.equal(stepOf(deck, 2), 0)
  assert.equal(stepOf(deck, 5), 0)
  assert.equal(stepOf(deck, 6), 1)
  assert.equal(stepOf(deck, 40), 4)
})

test('steps are keyed by kind and label, numbered when they repeat', () => {
  const twice: Schedule = { ...deck, steps: [deck.steps[0], deck.steps[1], deck.steps[2], { ...deck.steps[1], from: 11 }] }
  assert.deepEqual(stepKeys(twice), ['chapter:Hooks', 'break:', 'chapter:Effects', 'break:#2'])
  let day = enter(twice, EMPTY_DAY, 1, at(9, 45))
  day = enter(twice, day, 3, at(11, 0))
  assert.equal(current(twice, day), 3)
})

test('entering: the first entry starts the day at the deck\'s start; a step entered stays as it was', () => {
  let day = enter(deck, EMPTY_DAY, 0, at(9, 10))
  assert.deepEqual(day, { startedAt: at(9, 0), entered: { 'chapter:Hooks': at(9, 10) } })
  const again = enter(deck, day, 0, at(9, 30))
  assert.equal(again, day)
  day = enter(deck, day, 2, at(10, 5))
  assert.equal(current(deck, day), 2, 'the furthest entered; the skipped break counts as done')
})

test('without a deck start, the first entry is the origin', () => {
  const free: Schedule = { ...deck, start: null }
  const day = enter(free, EMPTY_DAY, 0, at(9, 10))
  assert.equal(day.startedAt, at(9, 10))
  assert.equal(origin(free, EMPTY_DAY, at(8, 0)), null)
  assert.equal(origin(deck, EMPTY_DAY, at(8, 0)), at(9, 0))
})

test('Start/Stop replaces the deck\'s start and shifts the chain, anchors staying put', () => {
  const day = startDay(EMPTY_DAY, at(9, 10))
  const planned = plan(deck, origin(deck, day, at(9, 10))!)
  assert.equal(planned[0].endsAt, at(9, 55))
  assert.equal(planned[2].endsAt, at(11, 10))
  assert.equal(planned[3].startsAt, at(12, 30))
})

test('before the first step: no delay, the first step is next', () => {
  const s = status(deck, EMPTY_DAY, at(8, 50))
  assert.equal(s.current, null)
  assert.equal(s.delay, null)
  assert.equal(s.remaining, null)
  assert.deepEqual(s.next, { step: deck.steps[0], at: at(9, 0) })
  assert.equal(status({ ...deck, start: null }, EMPTY_DAY, at(8, 50)).next!.at, null, 'unknown origin: no time yet')
  assert.equal(status(null, EMPTY_DAY, at(8, 50)).next, null)
})

test('the delay: entered late, then overrun, then skipped ahead', () => {
  /* Effects planned 10:00–11:00, entered 10:12. */
  const day = enter(deck, enter(deck, EMPTY_DAY, 0, at(9, 0)), 2, at(10, 12))
  let s = status(deck, day, at(10, 27))
  assert.equal(s.delay, 12)
  assert.equal(s.remaining, 45 * MIN)
  assert.equal(s.enteredAt, at(10, 12))
  assert.deepEqual(s.next, { step: deck.steps[3], at: at(12, 30) })

  s = status(deck, day, at(11, 12))
  assert.equal(s.delay, 12, 'unchanged at the planned end of the entered duration')
  assert.equal(s.remaining, 0)

  s = status(deck, day, at(11, 17))
  assert.equal(s.delay, 17, 'the overrun adds up')
  assert.equal(s.remaining, -5 * MIN)

  /* Skipping straight to Rendering (planned 13:30) at 13:20: 10 min early. */
  const later = enter(deck, day, 4, at(13, 20))
  s = status(deck, later, at(13, 25))
  assert.equal(s.delay, -10)
  assert.equal(s.next, null, 'nothing after the last step')
})

test('a zero-length step shows no remaining time; its delay is the time past its planned start', () => {
  const anchored: Schedule = { ...deck, steps: [{ from: 2, kind: 'chapter', label: 'Kickoff', durationMs: 0, at: 9 * 60 }] }
  const day = enter(anchored, EMPTY_DAY, 0, at(9, 3))
  const s = status(anchored, day, at(9, 8))
  assert.equal(s.remaining, null)
  assert.equal(s.delay, 8)
})

test('a reloaded deck without the current step falls back to the furthest step left', () => {
  const day = enter(deck, enter(deck, EMPTY_DAY, 0, at(9, 0)), 2, at(10, 0))
  const without: Schedule = { ...deck, steps: deck.steps.filter(s => s.label !== 'Effects') }
  assert.equal(current(without, day), 0)
  assert.equal(status(without, day, at(10, 30)).current!.step.label, 'Hooks')
})

test('the resume time of a screen slide: a break\'s end, else the next step\'s start', () => {
  const day = enter(deck, EMPTY_DAY, 0, at(9, 0))
  assert.equal(resumeTime(deck, day, at(9, 40), 6), at(10, 0), 'the break, not entered: its planned end')
  const onBreak = enter(deck, day, 1, at(9, 50))
  assert.equal(resumeTime(deck, onBreak, at(9, 52), 6), at(10, 5), 'entered: its actual end')
  assert.equal(resumeTime(deck, day, at(9, 40), 4), at(9, 45), 'a questions slide inside Hooks: the next step')
  assert.equal(resumeTime(deck, day, at(9, 40), 40), null, 'after the last step')
  assert.equal(resumeTime({ ...deck, start: null }, EMPTY_DAY, at(9, 40), 6), null, 'unknown origin')
  assert.equal(resumeTime(null, EMPTY_DAY, at(9, 40), 6), null)
})
