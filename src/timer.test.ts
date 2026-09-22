import type { SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from './config.ts'
import { act, phaseName, remaining, status } from './timer.ts'

const MIN = 60_000

function slide(extra: Partial<SlideInfo> = {}): SlideInfo {
  return { no: 4, title: null, chapter: 'Hooks', chapterNo: 1, progress: null, activity: 'Workshop 1', timer: ['15m'], screen: null, until: null, text: null, ...extra }
}

const names = resolveConfig()
const run = (timer: Parameters<typeof act>[0], action: Parameters<typeof act>[1], s: SlideInfo | null, now: number) =>
  act(timer, action, s, now, names)

test('starts the slide\'s activity, only when asked', () => {
  const t = run(null, 'toggle', slide(), 0)!
  assert.equal(t.label, 'Workshop 1')
  assert.equal(status(t, 0), 'running')
  assert.equal(remaining(t, 5 * MIN), 10 * MIN)
})

test('nothing to start without a timer on the slide', () => {
  assert.equal(run(null, 'toggle', slide({ timer: null }), 0), null)
  assert.equal(run(null, 'toggle', slide({ timer: ['soon'] }), 0), null)
  assert.equal(run(null, 'add', slide(), 0), null)
})

test('pause then resume keep the time left', () => {
  let t = run(null, 'toggle', slide(), 0)!
  t = run(t, 'toggle', null, 5 * MIN)!
  assert.equal(status(t, 20 * MIN), 'paused')
  assert.equal(remaining(t, 20 * MIN), 10 * MIN)
  t = run(t, 'toggle', null, 20 * MIN)!
  assert.equal(remaining(t, 21 * MIN), 9 * MIN)
})

test('one more minute, running, paused and once finished', () => {
  let t = run(null, 'toggle', slide(), 0)!
  t = run(t, 'add', null, MIN)!
  assert.equal(remaining(t, MIN), 15 * MIN)

  t = run(t, 'toggle', null, MIN)!
  t = run(t, 'add', null, 2 * MIN)!
  assert.equal(remaining(t, 10 * MIN), 16 * MIN)

  const done = { ...run(null, 'toggle', slide(), 0)!, rang: true }
  const again = run(done, 'add', null, 20 * MIN)!
  assert.equal(status(again, 20 * MIN), 'running')
  assert.equal(remaining(again, 20 * MIN), MIN)
  assert.equal(again.rang, false, 'the sound plays again at the new end')
})

test('toggle acknowledges a finished timer, cancel drops it', () => {
  const t = run(null, 'toggle', slide(), 0)!
  assert.equal(status(t, 15 * MIN), 'finished')
  assert.equal(run(t, 'toggle', slide(), 15 * MIN), null)
  assert.equal(run(t, 'cancel', slide(), MIN), null)
})

test('uses the default label when the activity has no name', () => {
  assert.equal(run(null, 'toggle', slide({ activity: null }), 0)!.label, 'Timer')
})

test('a timer started on a screen is dressed by it and named after it', () => {
  const t = run(null, 'toggle', slide({ screen: 'break', activity: 'ignored' }), 0)!
  assert.equal(t.style, 'break')
  assert.equal(t.label, 'Break')
  assert.equal(run(null, 'toggle', slide({ screen: 'break', text: 'Coffee' }), 0)!.label, 'Coffee')
  assert.equal(run(null, 'toggle', slide(), 0)!.style, null)
})

test('one more minute re-arms the break warning only above a minute', () => {
  const t = { ...run(null, 'toggle', slide({ screen: 'break' }), 0)!, warned: true }
  assert.equal(run(t, 'add', null, 14 * MIN)!.warned, false, '2 min left: warn again later')
  assert.equal(run(t, 'add', null, 15 * MIN)!.warned, true, 'at zero: 1 min left, no warning right away')
})

const lab = slide({ activity: 'Lab', timer: ['5m Reading', '10m Coding', '5m'] })

test('a phase over waits for the trainer, the last one finishes', () => {
  let t = run(null, 'toggle', lab, 0)!
  assert.equal(t.index, 0)
  assert.equal(status(t, 5 * MIN), 'waiting')
  t = run(t, 'toggle', null, 6 * MIN)!
  assert.equal(t.index, 1)
  assert.equal(status(t, 6 * MIN), 'running')
  assert.equal(remaining(t, 7 * MIN), 9 * MIN)
  t = run(t, 'toggle', null, 16 * MIN)!
  assert.equal(t.index, 2)
  assert.equal(status(t, 21 * MIN), 'finished')
})

test('skip ends a phase now, then starts the next one', () => {
  let t = run(null, 'toggle', lab, 0)!
  t = run(t, 'skip', null, MIN)!
  assert.equal(status(t, MIN), 'waiting')
  assert.equal(t.endsAt, MIN, 'waiting since now')
  t = run(t, 'skip', null, 2 * MIN)!
  assert.equal(t.index, 1)
  assert.equal(status(t, 2 * MIN), 'running')
  t = run(t, 'skip', null, 3 * MIN)!
  t = run(t, 'toggle', null, 3 * MIN)!
  t = run(t, 'skip', null, 4 * MIN)!
  assert.equal(status(t, 4 * MIN), 'finished', 'skipping the last phase finishes')
  assert.deepEqual(run(t, 'skip', null, 5 * MIN), t, 'nothing left to skip')
})

test('skip while paused also ends the phase', () => {
  let t = run(null, 'toggle', lab, 0)!
  t = run(t, 'toggle', null, MIN)!
  t = run(t, 'skip', null, 2 * MIN)!
  assert.equal(status(t, 2 * MIN), 'waiting')
})

test('one more minute while waiting reopens the phase that ended', () => {
  let t = run(null, 'toggle', lab, 0)!
  t = run(t, 'add', null, 6 * MIN)!
  assert.equal(t.index, 0)
  assert.equal(status(t, 6 * MIN), 'running')
  assert.equal(remaining(t, 6 * MIN), MIN)
})

test('phases are named, or numbered', () => {
  const t = run(null, 'toggle', lab, 0)!
  assert.equal(phaseName(t, 0, names.labels), 'Reading')
  assert.equal(phaseName(t, 2, names.labels), 'Phase 3')
})

test('a break keeps its first phase only', () => {
  const t = run(null, 'toggle', slide({ screen: 'break', timer: ['15m', '5m'] }), 0)!
  assert.equal(t.phases.length, 1)
})

test('toggle on a break slide starts the break, over a workshop still going', () => {
  let t = run(null, 'toggle', lab, 0)!
  assert.equal(status(t, 5 * MIN), 'waiting', 'a phase over, waiting for the trainer')
  const brk = slide({ screen: 'break', timer: ['15m'] })
  t = run(t, 'toggle', brk, 5 * MIN)!
  assert.equal(t.style, 'break')
  assert.equal(status(t, 5 * MIN), 'running')
  assert.equal(remaining(t, 5 * MIN), 15 * MIN)
})

test('a break of a minute or less starts already warned', () => {
  assert.equal(run(null, 'toggle', slide({ screen: 'break', timer: ['1m'] }), 0)!.warned, true)
  assert.equal(run(null, 'toggle', slide({ screen: 'break', timer: ['15m'] }), 0)!.warned, false)
})
