import type { IncomingMessage, ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoutes } from './routes.ts'

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
