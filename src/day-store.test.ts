import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDayStore, localDate } from './day-store.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'busybar-'))

test('saves the day with its date and loads it back the same day', async () => {
  const file = join(dir(), '.busybar-day.json')
  const store = createDayStore(file, () => '2026-09-26')
  await store.save({ startedAt: 1, entered: { 'chapter:Hooks': 2 } })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { date: '2026-09-26', startedAt: 1, entered: { 'chapter:Hooks': 2 } })
  assert.deepEqual(store.load(), { startedAt: 1, entered: { 'chapter:Hooks': 2 } })
})

test('another day, a missing or a malformed file: nothing loaded', async () => {
  const file = join(dir(), '.busybar-day.json')
  assert.equal(createDayStore(file, () => '2026-09-26').load(), null)
  await createDayStore(file, () => '2026-09-25').save({ startedAt: 1, entered: {} })
  assert.equal(createDayStore(file, () => '2026-09-26').load(), null)
  writeFileSync(file, '{"date":"2026-09-26","entered":"no"')
  assert.equal(createDayStore(file, () => '2026-09-26').load(), null)
  writeFileSync(file, '{"date":"2026-09-26","startedAt":5,"entered":{"a":1,"b":"2"}}')
  assert.deepEqual(createDayStore(file, () => '2026-09-26').load(), { startedAt: 5, entered: { a: 1 } })
})

test('localDate is the local calendar day', () => {
  assert.equal(localDate(new Date(2026, 8, 6)), '2026-09-06')
})

test('entries without a readable start are dropped: the day starts empty', () => {
  const file = join(dir(), '.busybar-day.json')
  writeFileSync(file, '{"date":"2026-09-26","startedAt":"9","entered":{"chapter:Hooks":1}}')
  assert.equal(createDayStore(file, () => '2026-09-26').load(), null)
})
