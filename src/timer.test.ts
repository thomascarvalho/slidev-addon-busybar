import type { SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, phase, remaining } from './timer.ts'

const MIN = 60_000

function slide(extra: Partial<SlideInfo> = {}): SlideInfo {
  return { no: 4, title: null, chapter: 'Hooks', chapterNo: 1, progress: null, activity: 'Workshop 1', timer: '15m', screen: null, until: null, text: null, ...extra }
}

const run = (timer: Parameters<typeof act>[0], action: Parameters<typeof act>[1], s: SlideInfo | null, now: number) =>
  act(timer, action, s, now, 'Timer')

test('starts the slide\'s activity, only when asked', () => {
  const t = run(null, 'toggle', slide(), 0)!
  assert.equal(t.label, 'Workshop 1')
  assert.equal(phase(t, 0), 'running')
  assert.equal(remaining(t, 5 * MIN), 10 * MIN)
})

test('nothing to start without a timer on the slide', () => {
  assert.equal(run(null, 'toggle', slide({ timer: null }), 0), null)
  assert.equal(run(null, 'toggle', slide({ timer: 'soon' }), 0), null)
  assert.equal(run(null, 'add', slide(), 0), null)
})

test('pause then resume keep the time left', () => {
  let t = run(null, 'toggle', slide(), 0)!
  t = run(t, 'toggle', null, 5 * MIN)!
  assert.equal(phase(t, 20 * MIN), 'paused')
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
  assert.equal(phase(again, 20 * MIN), 'running')
  assert.equal(remaining(again, 20 * MIN), MIN)
  assert.equal(again.rang, false, 'the sound plays again at the new end')
})

test('toggle acknowledges a finished timer, cancel drops it', () => {
  const t = run(null, 'toggle', slide(), 0)!
  assert.equal(phase(t, 15 * MIN), 'finished')
  assert.equal(run(t, 'toggle', slide(), 15 * MIN), null)
  assert.equal(run(t, 'cancel', slide(), MIN), null)
})

test('uses the default label when the activity has no name', () => {
  assert.equal(run(null, 'toggle', slide({ activity: null }), 0)!.label, 'Timer')
})
