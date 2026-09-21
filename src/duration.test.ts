import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatClock, parseDuration } from './duration.ts'

test('reads frontmatter durations', () => {
  assert.equal(parseDuration('90s'), 90_000)
  assert.equal(parseDuration('15m'), 900_000)
  assert.equal(parseDuration('1h30m'), 5_400_000)
  assert.equal(parseDuration('1h 30m 15s'), 5_415_000)
  assert.equal(parseDuration('20min'), 1_200_000)
})

test('rejects what is not a duration', () => {
  for (const value of ['', '15', 'fifteen minutes', '0m', 'm'])
    assert.equal(parseDuration(value), null, value)
})

test('shows the time left, rounded up to the second', () => {
  assert.equal(formatClock(754_000), '12:34')
  assert.equal(formatClock(753_001), '12:34')
  assert.equal(formatClock(59_000), '0:59')
  assert.equal(formatClock(3_723_000), '1:02:03')
  assert.equal(formatClock(-500), '0:00')
})
