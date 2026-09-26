import assert from 'node:assert/strict'
import { test } from 'node:test'
import { label, pixels, rect, textWidth, digits, digitsWidth } from './draw.ts'

test('rect is a solid rectangle in the bar\'s colour format', () => {
  assert.deepEqual(rect('r', 1, 2, 3, 4, '#f00'), {
    id: 'r', type: 'rectangle', x: 1, y: 2, width: 3, height: 4, fill: 'solid', fill_colors: ['#FF0000FF'], border_width: 0,
  })
})

test('pixels builds an XPM2 bitmap, dots transparent', () => {
  const element = pixels('p', ['#.', '.#'], { '#': '#F65E5E' }, 5, 6)
  assert.equal(element.type, 'xpmbitmap')
  assert.equal((element as { data: string }).data, '! XPM2\n2 2 2 1\n. c none\n# c #F65E5E\n#.\n.#')
  assert.equal(element.x, 5)
  assert.equal(element.y, 6)
})

test('label and textWidth use the bar\'s fonts', () => {
  assert.ok(textWidth('defsquare', 'bold') > 0)
  assert.equal((label('l', 'Hi', 'bold', '#FFFFFF', 3, 4) as { font: string }).font, 'bold')
})

test('digits: 3×5 glyphs scaled, one column apart', () => {
  assert.equal(digitsWidth('10:52', 3), 57)
  assert.equal(digitsWidth('', 3), 0)
  const e = digits('clock', '1', '#FFFFFF', 10, 4, 2) as { x: number, y: number, data: string }
  assert.equal(e.x, 10)
  assert.equal(e.y, 4)
  assert.ok(e.data.startsWith('! XPM2\n6 10 '), e.data)
  assert.match(e.data, /\n\.\.##\.\.\n/)
  const right = digits('delay', '+12', '#8A8A8AFF', 148, 3, 3, 'right') as { x: number }
  assert.equal(right.x, 148 - 33)
})
