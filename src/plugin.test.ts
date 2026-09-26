import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSchedule, parseSlide } from './plugin.ts'

test('a slide from the browser: phases as a list, capped', () => {
  assert.deepEqual(parseSlide({ no: 1, timer: '15m' })!.timer, ['15m'])
  assert.deepEqual(parseSlide({ no: 1, timer: ['5m A', 3, '', '5m B'] })!.timer, ['5m A', '3', '5m B'])
  assert.equal(parseSlide({ no: 1, timer: Array.from({ length: 20 }, () => '1m') })!.timer!.length, 10)
  assert.equal(parseSlide({ no: 1 })!.timer, null)
})

test('a slide\'s sound from the browser: a string, false, or nothing', () => {
  assert.equal(parseSlide({ no: 1, sound: 'sounds/gong.wav' })!.sound, 'sounds/gong.wav')
  assert.equal(parseSlide({ no: 1, sound: false })!.sound, false)
  assert.equal(parseSlide({ no: 1, sound: 42 })!.sound, '42')
  assert.equal(parseSlide({ no: 1 })!.sound, null)
})

test('a schedule from the browser: validated, capped, nothing else trusted', () => {
  const s = parseSchedule({ start: 540, end: null, steps: [{ from: 2, kind: 'chapter', label: 'Hooks', durationMs: 60_000, at: null }, { from: 4, kind: 'break', label: null, durationMs: 0, at: 750 }], warnings: ['slide 3: busy.at "x" is not a time (HH:MM)'] })!
  assert.deepEqual(s, { start: 540, end: null, steps: [{ from: 2, kind: 'chapter', label: 'Hooks', durationMs: 60_000, at: null }, { from: 4, kind: 'break', label: null, durationMs: 0, at: 750 }], warnings: ['slide 3: busy.at "x" is not a time (HH:MM)'] })
  assert.equal(parseSchedule({ steps: 'none' }), null)
  assert.equal(parseSchedule({ start: 540, end: null, steps: [{ from: 'two', kind: 'chapter', label: null, durationMs: 0, at: null }], warnings: [] }), null)
  assert.equal(parseSchedule({ start: 1500, end: null, steps: [], warnings: [] }), null, 'a start past midnight')
  assert.equal(parseSchedule({ start: null, end: null, steps: Array.from({ length: 300 }, (_, i) => ({ from: i + 1, kind: 'chapter', label: 'C', durationMs: 1000, at: null })), warnings: [] })!.steps.length, 200)
})
