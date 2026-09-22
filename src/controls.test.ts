import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CONTROLS, resolveConfig } from './config.ts'
import { buttonAction, route, wheelAction } from './controls.ts'
import { Button } from './input.ts'

test('by default, Start/Stop runs the timer, Back held cancels it, OK does nothing', () => {
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.START, false), 'timer:toggle')
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.START, true), 'timer:add')
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.BACK, false), false)
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.BACK, true), 'timer:cancel')
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.OK, false), false)
})

test('the wheel steps through clicks, or through slides', () => {
  assert.equal(wheelAction(DEFAULT_CONTROLS, 1), 'next')
  assert.equal(wheelAction(DEFAULT_CONTROLS, -1), 'prev')
  const slides = { ...DEFAULT_CONTROLS, wheel: 'slides' as const }
  assert.equal(wheelAction(slides, 1), 'nextSlide')
  assert.equal(wheelAction(slides, -1), 'prevSlide')
  assert.equal(wheelAction({ ...DEFAULT_CONTROLS, wheel: false }, 1), false)
})

test('timer actions stay on the server, the others go to Slidev', () => {
  assert.deepEqual(route('timer:toggle'), { timer: 'toggle' })
  assert.deepEqual(route('timer:add'), { timer: 'add' })
  assert.deepEqual(route('timer:cancel'), { timer: 'cancel' })
  assert.deepEqual(route('overview'), { slidev: 'overview' })
  assert.deepEqual(route('goto:3'), { slidev: 'goto:3' })
  assert.equal(route(false), null)
})

test('controls are merged with the defaults, or turned off', () => {
  const controls = resolveConfig({ controls: { ok: 'goto:2', wheel: 'slides' } }).controls
  assert.equal(controls?.ok, 'goto:2')
  assert.equal(controls?.wheel, 'slides')
  assert.equal(controls?.start, 'timer:toggle')
  assert.equal(resolveConfig({ controls: false }).controls, null)
})

test('an unknown action is refused with the name of the control', () => {
  assert.throws(() => resolveConfig({ controls: { back: 'jump' as never } }), /controls\.back: unknown action "jump"/)
  assert.throws(() => resolveConfig({ controls: { ok: 'goto:0' as never } }), /controls\.ok/)
  assert.throws(() => resolveConfig({ controls: { wheel: 'pages' as never } }), /controls\.wheel/)
  assert.throws(() => resolveConfig({ controls: { start: 'timer' as never } }), /controls\.start/)
})
