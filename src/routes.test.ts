import type { IncomingMessage, ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoutes, parseSchedule, parseSlide } from './routes.ts'

/** A request and a response the way `createRoutes` reads and writes them. */
function request(method: string, url: string, body?: unknown) {
  const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign((async function* () {
    yield raw
  })(), { method, url }) as unknown as IncomingMessage
  const res = { statusCode: 0, end() {} } as unknown as ServerResponse
  return { req, res }
}

function harness() {
  const seen: string[] = []
  const handle = createRoutes({
    slide: slide => void seen.push(`slide ${slide.no}${slide.sound ? ` sound ${slide.sound}` : ''}`),
    schedule: schedule => void seen.push(`schedule ${schedule.steps.length}`),
    timer: action => void seen.push(`timer ${action}`),
  })
  return { seen, handle }
}

test('each route parses its body, answers 204 and acts', async () => {
  const { seen, handle } = harness()
  for (const [url, body] of [
    ['/slide', { no: 3, sound: 'gong.wav' }],
    ['/schedule', { start: null, end: null, steps: [{ from: 2, kind: 'chapter', label: 'A', durationMs: 1000, at: null }], warnings: [] }],
    ['/timer', { action: 'toggle' }],
  ] as const) {
    const { req, res } = request('POST', url, body)
    await handle(req, res)
    assert.equal(res.statusCode, 204, url)
  }
  assert.deepEqual(seen, ['slide 3 sound gong.wav', 'schedule 1', 'timer toggle'])
})

test('a bad body is a 400 and nothing happens', async () => {
  const { seen, handle } = harness()
  for (const [url, body] of [['/slide', { no: 'three' }], ['/schedule', { steps: 'none' }], ['/timer', { action: 'nope' }], ['/timer', 'not json']] as const) {
    const { req, res } = request('POST', url, body)
    await handle(req, res)
    assert.equal(res.statusCode, 400, url)
  }
  assert.deepEqual(seen, [])
})

test('only POST, only known routes', async () => {
  const { handle } = harness()
  const get = request('GET', '/slide')
  await handle(get.req, get.res)
  assert.equal(get.res.statusCode, 405)
  const unknown = request('POST', '/nope', {})
  await handle(unknown.req, unknown.res)
  assert.equal(unknown.res.statusCode, 404)
})


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
