import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSlide } from './plugin.ts'

test('a slide from the browser: phases as a list, capped', () => {
  assert.deepEqual(parseSlide({ no: 1, timer: '15m' })!.timer, ['15m'])
  assert.deepEqual(parseSlide({ no: 1, timer: ['5m A', 3, '', '5m B'] })!.timer, ['5m A', '3', '5m B'])
  assert.equal(parseSlide({ no: 1, timer: Array.from({ length: 20 }, () => '1m') })!.timer!.length, 10)
  assert.equal(parseSlide({ no: 1 })!.timer, null)
})
