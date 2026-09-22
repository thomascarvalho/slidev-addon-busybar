import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CONTROLS, resolveConfig } from './config.ts'
import { buttonAction, route, settingAction, wheelAction } from './controls.ts'
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
  assert.deepEqual(route('timer:skip'), { timer: 'skip' })
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
  assert.equal(resolveConfig({ controls: { ok: 'timer:skip' } }).controls?.ok, 'timer:skip')
  assert.equal(resolveConfig({ controls: false }).controls, null)
})

test('an unknown action is refused with the name of the control', () => {
  assert.throws(() => resolveConfig({ controls: { back: 'jump' as never } }), /controls\.back: unknown action "jump"/)
  assert.throws(() => resolveConfig({ controls: { ok: 'goto:0' as never } }), /controls\.ok/)
  assert.throws(() => resolveConfig({ controls: { wheel: 'pages' as never } }), /controls\.wheel/)
  assert.throws(() => resolveConfig({ controls: { start: 'timer' as never } }), /controls\.start/)
})

test('timer:set opens the setting, on the wheel\'s click held by default', () => {
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.OK, true), 'timer:set')
  assert.equal(buttonAction(DEFAULT_CONTROLS, Button.OK, false), false)
  assert.deepEqual(route('timer:set'), { set: true })
})

test('while the setting is open, only start and close reach it', () => {
  assert.equal(settingAction('toggle'), 'start')
  assert.equal(settingAction('timer:toggle'), 'start')
  assert.equal(settingAction('cancel'), 'close')
  assert.equal(settingAction('timer:cancel'), 'close')
  assert.equal(settingAction('timer:set'), 'close')
  assert.equal(settingAction('add'), null)
  assert.equal(settingAction('skip'), null)
  assert.equal(settingAction('timer:add'), null)
  assert.equal(settingAction('timer:skip'), null)
  assert.equal(settingAction('overview'), null)
  assert.equal(settingAction('goto:3'), null)
  assert.equal(settingAction(false), null)
})
