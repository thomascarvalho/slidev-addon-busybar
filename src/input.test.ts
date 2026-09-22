import type { BarInput } from './input.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Button, createControls, decodeInputs, LONG_PRESS_MS, SwitchPosition } from './input.ts'

/* Protobuf encoding, just enough to rebuild what the bar sends. */
const varint = (n: number): number[] => n < 0x80 ? [n] : [(n & 0x7F) | 0x80, ...varint(n >>> 7)]
const bytesField = (no: number, body: number[]) => [(no << 3) | 2, ...varint(body.length), ...body]
const varintField = (no: number, n: number) => [(no << 3), ...varint(n)]
const timestamp = [0x09, 0xB5, 0x38, 0x35, 0xC8, 0xA0, 0x01, 0x00, 0x00]
/** A `State` with one `StateUpdate` per `InputEvent` given. */
const state = (...events: number[][]) => new Uint8Array([...timestamp, ...events.flatMap(e => bytesField(2, bytesField(11, e)))])

const button = (no: number, pressed: boolean) => bytesField(1, [...(no ? varintField(1, no) : []), ...(pressed ? [] : varintField(2, 1))])
const wheel = (zigzag: number) => bytesField(3, varintField(1, zigzag))
const position = (no: number) => bytesField(2, no ? varintField(1, no) : [])

test('decodes the Start/Stop button, pressed then released', () => {
  assert.deepEqual(decodeInputs(state(button(2, true))), [{ kind: 'button', button: Button.START, pressed: true }])
  assert.deepEqual(decodeInputs(state(button(2, false))), [{ kind: 'button', button: Button.START, pressed: false }])
})

test('decodes a button whose fields all hold their default (OK, pressed)', () => {
  assert.deepEqual(decodeInputs(state(button(0, true))), [{ kind: 'button', button: Button.OK, pressed: true }])
})

test('decodes wheel notches, zigzag-encoded, and several in one message', () => {
  assert.deepEqual(decodeInputs(state(wheel(2))), [{ kind: 'wheel', delta: 1 }])
  assert.deepEqual(decodeInputs(state(wheel(1), wheel(1))), [{ kind: 'wheel', delta: -1 }, { kind: 'wheel', delta: -1 }])
})

test('decodes switch positions, BUSY included (an empty message)', () => {
  assert.deepEqual(decodeInputs(state(position(0))), [{ kind: 'switch', position: SwitchPosition.BUSY }])
  assert.deepEqual(decodeInputs(state(position(3))), [{ kind: 'switch', position: SwitchPosition.APPS }])
})

test('ignores frames, Wi-Fi status, heartbeats and garbage', () => {
  const frame = new Uint8Array([...timestamp, ...bytesField(2, bytesField(10, [0x10, 72, 0x18, 16]))])
  assert.deepEqual(decodeInputs(frame), [])
  assert.deepEqual(decodeInputs(new Uint8Array(timestamp)), [])
  assert.deepEqual(decodeInputs(new Uint8Array([0x12, 0x40, 0x01])), [])
})

/* Timers run by hand. */
function fakeClock() {
  let now = 0
  let pending: { at: number, fn: () => void }[] = []
  return {
    setTimeout: (fn: () => void, ms: number) => {
      const entry = { at: now + ms, fn }
      pending.push(entry)
      return entry
    },
    clearTimeout: (handle: unknown) => {
      pending = pending.filter(e => e !== handle)
    },
    advance(ms: number) {
      now += ms
      for (const entry of pending.filter(e => e.at <= now)) {
        pending = pending.filter(e => e !== entry)
        entry.fn()
      }
    },
  }
}

function controls() {
  const clock = fakeClock()
  const calls: string[] = []
  const c = createControls({
    step: delta => calls.push(`step ${delta}`),
    press: (b, long) => calls.push(`${long ? 'long' : 'short'} ${b}`),
    switched: p => calls.push(`switch ${p}`),
  }, clock)
  const send = (...events: BarInput[]) => events.forEach(c.input)
  return { clock, calls, send, reset: c.reset }
}

const down = (b: Button): BarInput => ({ kind: 'button', button: b, pressed: true })
const up = (b: Button): BarInput => ({ kind: 'button', button: b, pressed: false })

test('a short press fires on release', () => {
  const { clock, calls, send } = controls()
  send(down(Button.START))
  clock.advance(100)
  assert.deepEqual(calls, [])
  send(up(Button.START))
  assert.deepEqual(calls, [`short ${Button.START}`])
})

test('a long press fires while held, and not again on release', () => {
  const { clock, calls, send } = controls()
  send(down(Button.BACK))
  clock.advance(LONG_PRESS_MS)
  assert.deepEqual(calls, [`long ${Button.BACK}`])
  clock.advance(1000)
  send(up(Button.BACK))
  assert.deepEqual(calls, [`long ${Button.BACK}`])
})

test('held, a button without a hold action is a plain press', () => {
  const clock = fakeClock()
  const calls: string[] = []
  const c = createControls({
    step: () => {},
    press: (b, long) => calls.push(`${long ? 'long' : 'short'} ${b}`),
    holds: b => b !== Button.OK,
    switched: () => {},
  }, clock)
  c.input(down(Button.OK))
  clock.advance(2000)
  c.input(up(Button.OK))
  assert.deepEqual(calls, [`short ${Button.OK}`])
})

test('a release without a press (after a reconnection) does nothing', () => {
  const { calls, send } = controls()
  send(up(Button.START))
  assert.deepEqual(calls, [])
})

test('reset forgets a held button', () => {
  const { clock, calls, send, reset } = controls()
  send(down(Button.START))
  reset()
  clock.advance(LONG_PRESS_MS)
  send(up(Button.START))
  assert.deepEqual(calls, [])
})

test('each wheel notch is a step', () => {
  const { calls, send } = controls()
  send({ kind: 'wheel', delta: 1 }, { kind: 'wheel', delta: 1 }, { kind: 'wheel', delta: -1 })
  assert.deepEqual(calls, ['step 1', 'step 1', 'step -1'])
})

test('the switch reports where it rests, not the positions it sweeps', () => {
  const { clock, calls, send } = controls()
  send(
    { kind: 'switch', position: SwitchPosition.OFF },
    { kind: 'switch', position: SwitchPosition.CUSTOM },
    { kind: 'switch', position: SwitchPosition.BUSY },
  )
  clock.advance(1000)
  send({ kind: 'switch', position: SwitchPosition.CUSTOM })
  clock.advance(100)
  send({ kind: 'switch', position: SwitchPosition.OFF }, { kind: 'switch', position: SwitchPosition.APPS })
  clock.advance(1000)
  assert.deepEqual(calls, [`switch ${SwitchPosition.BUSY}`, `switch ${SwitchPosition.APPS}`])
})
