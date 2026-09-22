import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatClock, parseDuration, parsePhases } from './duration.ts'

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

test('reads workshop phases: a duration, then an optional name', () => {
  assert.deepEqual(parsePhases(['5m Reading', '10m Coding', '1h 30m Long lab', '5m']), [
    { label: 'Reading', ms: 300_000 },
    { label: 'Coding', ms: 600_000 },
    { label: 'Long lab', ms: 5_400_000 },
    { label: null, ms: 300_000 },
  ])
})

test('a single duration is a single unnamed phase', () => {
  assert.deepEqual(parsePhases('15m'), [{ label: null, ms: 900_000 }])
})

test('one unreadable phase and there is no timer', () => {
  assert.equal(parsePhases(['5m Reading', 'soon Coding']), null)
  assert.equal(parsePhases([]), null)
  assert.equal(parsePhases('Reading'), null)
})
