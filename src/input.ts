/* The bar's buttons, wheel and switch, as streamed on `/api/status/ws`. It
   knows neither the network nor Slidev, so it can be tested on bytes.

   The stream is protobuf (`BSB_State` in busy-lib): a `State` holds a
   timestamp (field 1) and `StateUpdate`s (field 2), whose `input` is field 11.
   Decoding only these few fields avoids depending on protobufjs. */

/* Plain objects rather than enums: Node runs the tests by stripping types. */
export const Button = { OK: 0, BACK: 1, START: 2 } as const
export type Button = typeof Button[keyof typeof Button]

export const SwitchPosition = { BUSY: 0, CUSTOM: 1, OFF: 2, APPS: 3, SETTINGS: 4 } as const
export type SwitchPosition = typeof SwitchPosition[keyof typeof SwitchPosition]

export type BarInput =
  | { kind: 'button', button: Button, pressed: boolean }
  | { kind: 'wheel', delta: number }
  | { kind: 'switch', position: SwitchPosition }

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_BYTES = 2
const WIRE_FIXED32 = 5

interface Field { no: number, value: number | Uint8Array }

/** Top-level fields of a protobuf message; throws on malformed input. */
function fields(bytes: Uint8Array): Field[] {
  const out: Field[] = []
  let i = 0
  const varint = () => {
    let value = 0
    let shift = 0
    for (;;) {
      if (i >= bytes.length)
        throw new Error('truncated')
      const byte = bytes[i++]
      /* Our values fit in 32 bits; larger ones are read but not used. */
      if (shift < 32)
        value |= (byte & 0x7F) << shift
      shift += 7
      if (!(byte & 0x80))
        return value >>> 0
    }
  }
  while (i < bytes.length) {
    const key = varint()
    const no = key >>> 3
    switch (key & 7) {
      case WIRE_VARINT: out.push({ no, value: varint() }); break
      case WIRE_FIXED64: i += 8; break
      case WIRE_FIXED32: i += 4; break
      case WIRE_BYTES: {
        const length = varint()
        if (i + length > bytes.length)
          throw new Error('truncated')
        out.push({ no, value: bytes.subarray(i, i + length) })
        i += length
        break
      }
      default: throw new Error(`wire type ${key & 7}`)
    }
  }
  if (i > bytes.length)
    throw new Error('truncated')
  return out
}

const child = (list: Field[], no: number) => list.find(f => f.no === no && f.value instanceof Uint8Array)?.value as Uint8Array | undefined
/* Missing scalar fields hold their default, 0. */
const scalar = (list: Field[], no: number) => (list.find(f => f.no === no && typeof f.value === 'number')?.value as number | undefined) ?? 0
const zigzag = (n: number) => (n >>> 1) ^ -(n & 1)

/** The inputs carried by one stream message; none for screen frames, Wi-Fi
    status and the like, or when the message cannot be read. */
export function decodeInputs(bytes: Uint8Array): BarInput[] {
  const out: BarInput[] = []
  try {
    for (const update of fields(bytes)) {
      if (update.no !== 2 || !(update.value instanceof Uint8Array))
        continue
      const input = child(fields(update.value), 11)
      if (!input)
        continue
      const event = fields(input)
      const button = child(event, 1)
      const position = child(event, 2)
      const wheel = child(event, 3)
      if (button) {
        const f = fields(button)
        out.push({ kind: 'button', button: scalar(f, 1) as Button, pressed: scalar(f, 2) === 0 })
      }
      else if (position) {
        out.push({ kind: 'switch', position: scalar(fields(position), 1) as SwitchPosition })
      }
      else if (wheel) {
        const delta = zigzag(scalar(fields(wheel), 1))
        if (delta)
          out.push({ kind: 'wheel', delta })
      }
    }
  }
  catch {
    return []
  }
  return out
}

/** Held this long, a button does its "long press" action. */
export const LONG_PRESS_MS = 600
/* The switch is rotary: going from APPS to BUSY passes CUSTOM and OFF. */
const SWITCH_SETTLE_MS = 400

export interface ControlHandlers {
  /** Wheel turned: positive forward, negative backward. */
  step: (delta: number) => void
  press: (button: Button, long: boolean) => void
  /** Whether `button` does something when held; if not, holding it is a
      plain press. */
  holds?: (button: Button) => boolean
  /** The switch rests on a new position. */
  switched: (position: SwitchPosition) => void
}

export interface ControlOptions {
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/** Turns raw inputs into actions: a short press fires on release, a long one
    as soon as it has been held `LONG_PRESS_MS`, without waiting for the
    release, so that holding the button gives feedback on the bar. */
export function createControls(handlers: ControlHandlers, options: ControlOptions = {}) {
  const set = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clear = options.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const held = new Map<Button, { timer: unknown, fired: boolean }>()
  let settling: unknown
  let position: SwitchPosition | null = null

  function input(event: BarInput) {
    switch (event.kind) {
      case 'wheel':
        handlers.step(event.delta)
        return
      case 'switch':
        clear(settling)
        settling = set(() => {
          if (event.position !== position) {
            position = event.position
            handlers.switched(event.position)
          }
        }, SWITCH_SETTLE_MS)
        return
      case 'button': {
        const state = held.get(event.button)
        if (event.pressed) {
          if (state)
            return
          const next = { fired: false, timer: undefined as unknown }
          if (handlers.holds?.(event.button) ?? true) {
            next.timer = set(() => {
              next.fired = true
              handlers.press(event.button, true)
            }, LONG_PRESS_MS)
          }
          held.set(event.button, next)
          return
        }
        if (!state)
          return
        clear(state.timer)
        held.delete(event.button)
        if (!state.fired)
          handlers.press(event.button, false)
      }
    }
  }

  /** Drops pending presses, after a disconnection: a release may be lost. */
  function reset() {
    for (const state of held.values())
      clear(state.timer)
    held.clear()
    clear(settling)
  }

  return { input, reset }
}
