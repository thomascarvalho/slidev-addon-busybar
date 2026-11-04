import type { Bar } from './painter.ts'
import type { Element } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeBarError } from './errors.ts'
import { createPainter } from './painter.ts'

/* A bar that records calls. `running`: an app (Clock…) holds the screen,
   so a draw is refused until it is quit. `negotiated`: whether the client
   already knows the bar's API version. */
function fakeBar({ semver = '27.14.0', running = false, negotiated = true } = {}) {
  const calls: string[] = []
  const state = { running, quits: 0 }
  const bar: Bar = {
    apiSemver: negotiated ? semver : '',
    async systemVersionGet() {
      calls.push('version')
      bar.apiSemver = semver
      return { api_semver: semver }
    },
    async appsQuit() {
      state.quits++
      if (!state.running)
        throw Object.assign(new Error('Application is not running'), { status: 409 })
      state.running = false
      calls.push('quit')
      return { result: 'OK' }
    },
    async displayDraw(params) {
      if (state.running)
        throw Object.assign(new Error('Not drawn due to low priority'), { status: 409 })
      calls.push(`draw ${params.elements.map(e => e.id).join(',')}${params.led_notification_color ? ` led ${params.led_notification_color}` : ''}`)
      return { result: 'OK' }
    },
    async displayClear(params) {
      calls.push(params?.element_ids ? `clear ${params.element_ids.join(',')}` : 'clear all')
      return { result: 'OK' }
    },
    async audioPlay() {
      return { result: 'OK' }
    },
  }
  return { bar, calls, state }
}

const text = (id: string, value: string): Element => ({ id, type: 'text', text: value, font: 'global', color: '#FFFFFFFF', x: 0, y: 0 })
const rect = (id: string, fill: 'solid' | 'gradient_h'): Element => ({ id, type: 'rectangle', x: 0, y: 15, width: 10, height: 1, fill, fill_colors: ['#FF0000FF'], border_width: 0 })

test('the first paint clears everything, the next ones only what changed or went away', async () => {
  const { bar, calls } = fakeBar()
  const painter = createPainter(bar, {})
  assert.equal(await painter.paint({ elements: [text('a', '1'), text('b', '1')], nextAt: null }), true)
  assert.equal(await painter.paint({ elements: [text('a', '1'), text('b', '1')], nextAt: null }), false, 'nothing to send')
  await painter.paint({ elements: [text('a', '2')], nextAt: null })
  assert.deepEqual(calls, ['clear all', 'draw a,b', 'clear b', 'draw a'])
})

test('an element that changes kind or fill is cleared before being drawn again', async () => {
  const { bar, calls } = fakeBar()
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [rect('r', 'gradient_h')], nextAt: null })
  await painter.paint({ elements: [rect('r', 'solid')], nextAt: null })
  assert.deepEqual(calls.slice(2), ['clear r', 'draw r'])
})

test('the LED alone is worth a draw', async () => {
  const { bar, calls } = fakeBar()
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  await painter.paint({ elements: [text('a', '1')], nextAt: null, led: '#FF0000FF' })
  assert.deepEqual(calls.at(-1), 'draw a led #FF0000FF')
})

test('forget: the next paint clears everything again; clear: only after something was drawn', async () => {
  const { bar, calls } = fakeBar()
  const painter = createPainter(bar, {})
  await painter.clear()
  assert.deepEqual(calls, [], 'never drew')
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  painter.forget()
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  await painter.clear()
  assert.deepEqual(calls, ['clear all', 'draw a', 'clear all', 'draw a', 'clear all'])
})

test('the first paint quits the app running on the bar before taking the screen', async () => {
  const { bar, calls } = fakeBar({ running: true })
  const messages: string[] = []
  const painter = createPainter(bar, { info: m => messages.push(m) })
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  assert.deepEqual(calls, ['quit', 'clear all', 'draw a'])
  assert.match(messages.join('\n'), /quit the app running on the bar/)
})

test('no app running on the bar: the 409 of the quit is silent', async () => {
  const { bar, calls, state } = fakeBar({ running: false })
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  assert.equal(state.quits, 1)
  assert.deepEqual(calls, ['clear all', 'draw a'])
})

test('a bar still on firmware 1.2 is never asked to quit an app', async () => {
  const { bar, calls, state } = fakeBar({ semver: '27.5.0' })
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  assert.equal(state.quits, 0, '27.5.0 is below 27.14.0, whatever the string order says')
  assert.deepEqual(calls, ['clear all', 'draw a'])
})

test('the API version is asked to the bar when the client has not negotiated it yet', async () => {
  const { bar, calls } = fakeBar({ running: true, negotiated: false })
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  assert.deepEqual(calls, ['version', 'quit', 'clear all', 'draw a'])
})

test('a draw refused while an app took the screen quits it and is sent again, once', async () => {
  const { bar, calls, state } = fakeBar()
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  state.running = true
  await painter.paint({ elements: [text('a', '2')], nextAt: null })
  assert.deepEqual(calls, ['clear all', 'draw a', 'quit', 'draw a'])
})

test('a draw refused for another reason (the BUSY timer, the switch) is thrown as it is', async () => {
  const { bar, state } = fakeBar()
  const painter = createPainter(bar, {})
  await painter.paint({ elements: [text('a', '1')], nextAt: null })
  state.running = true
  bar.appsQuit = async () => {
    throw Object.assign(new Error('Application is not running'), { status: 409 })
  }
  await assert.rejects(painter.paint({ elements: [text('a', '2')], nextAt: null }), { status: 409 })
})

test('bar errors are described for a trainer', () => {
  assert.match(describeBarError({ status: 409 }), /APPS/)
  assert.match(describeBarError({ status: 409 }), /quit the app/)
  assert.match(describeBarError({ status: 400, message: 'elements[0].display value is invalid' }), /400\): elements\[0\]\.display value is invalid/)
  assert.match(describeBarError({ status: 403 }), /BUSYBAR_PASSWORD/)
  assert.match(describeBarError({ name: 'TimeoutError' }), /not responding/)
  assert.match(describeBarError(new Error('fetch failed')), /unreachable \(fetch failed\)/)
  assert.match(describeBarError(new Error('fetch failed', { cause: { code: 'EHOSTUNREACH' } })), /Local Network/)
})
