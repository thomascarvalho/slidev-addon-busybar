import type { Bar } from './painter.ts'
import type { Element } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPainter, describeBarError } from './painter.ts'

function fakeBar() {
  const calls: string[] = []
  const bar: Bar = {
    async DisplayDraw(params) {
      calls.push(`draw ${params.elements.map(e => e.id).join(',')}${params.led_notification_color ? ` led ${params.led_notification_color}` : ''}`)
      return { result: 'OK' }
    },
    async DisplayClear(params) {
      calls.push(params?.element_ids ? `clear ${params.element_ids.join(',')}` : 'clear all')
      return { result: 'OK' }
    },
    async AudioPlay() {
      return { result: 'OK' }
    },
  }
  return { bar, calls }
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

test('bar errors are described for a trainer', () => {
  assert.match(describeBarError({ status: 409 }), /APPS/)
  assert.match(describeBarError({ status: 403 }), /BUSYBAR_PASSWORD/)
  assert.match(describeBarError({ name: 'TimeoutError' }), /not responding/)
  assert.match(describeBarError(new Error('fetch failed')), /unreachable \(fetch failed\)/)
})
