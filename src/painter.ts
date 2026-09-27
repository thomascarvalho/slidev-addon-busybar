/* The painter puts a scene on the bar: it remembers what the bar shows and
   sends only the difference. It knows nothing of slides, timers or the day:
   the relay decides what to draw, the painter how to send it.

   Firmware facts it works around: a `DisplayDraw` adds to the application's
   elements, drawing again under the same id merges fields (a rectangle keeps
   its gradient when redrawn solid), and clearing an id that is not on screen
   is a 400. */
import type { AudioPlayParams, DisplayClearParams, DisplayDrawParams, RequestOptions, SuccessResponse } from '@busy-app/busy-lib'
import type { Scene } from './render.ts'
import type { Element } from './types.ts'
import { APPLICATION } from './sounds.ts'

const PRIORITY = 50
export const TIMEOUT_MS = 1500

/** What the addon needs from a `BusyBar` client. */
export interface Bar {
  DisplayDraw: (params: DisplayDrawParams, options?: RequestOptions) => Promise<SuccessResponse>
  DisplayClear: (params?: DisplayClearParams, options?: RequestOptions) => Promise<SuccessResponse>
  AudioPlay: (params: AudioPlayParams, options?: RequestOptions) => Promise<SuccessResponse>
}

export interface PainterOptions {
  /** Every call to the bar, with `BUSYBAR_DEBUG=true`. */
  debug?: (message: string) => void
}

export function createPainter(bar: Bar, options: PainterOptions = {}) {
  /* What the bar shows, by element id; `null` when we do not know (at start,
     after a failure), which forces a full clear: a server killed abruptly may
     have left its elements on screen. */
  let shown: Map<string, string> | null = null
  /* LED colour requested by the last draw. */
  let shownLed: string | undefined
  /* Whether we ever drew: a painter that never could leaves the bar alone on exit. */
  let touched = false

  /** Sends what differs from the last scene; `false` when nothing did.
      Throws when the bar does: the caller owns the retry. */
  async function paint(scene: Scene): Promise<boolean> {
    const elements = scene.elements
    const changed = elements.filter(e => shown?.get(e.id) !== JSON.stringify(e))
    const removed = shown ? [...shown.keys()].filter(id => !elements.some(e => e.id === id)) : []
    for (const e of changed) {
      const before = shown?.get(e.id)
      if (before && morphs(JSON.parse(before), e))
        removed.push(e.id)
    }
    /* The LED is set by a draw: draw again if only the LED changes. */
    if (scene.led !== shownLed && !changed.length && elements.length)
      changed.push(elements[0])
    if (shown && !changed.length && !removed.length)
      return false
    await send(changed, removed, scene.led)
    shown = new Map(elements.map(e => [e.id, JSON.stringify(e)]))
    shownLed = scene.led
    return true
  }

  async function send(changed: Element[], removed: string[], led?: string) {
    options.debug?.(`${shown ? `clear [${removed}]` : 'clear all'}, draw [${changed.map(e => e.id)}]${led ? `, LED ${led}` : ''}`)
    const request = { timeout: TIMEOUT_MS }
    if (!shown)
      await bar.DisplayClear({ application_name: APPLICATION }, request)
    else if (removed.length)
      await bar.DisplayClear({ application_name: APPLICATION, element_ids: removed }, request)
    touched = true
    if (changed.length) {
      await bar.DisplayDraw({
        application_name: APPLICATION,
        priority: PRIORITY,
        elements: changed,
        ...(led ? { led_notification_color: led } : {}),
      }, request)
    }
  }

  /** Forgets what the bar shows: the next paint clears everything first
      (after a failure, or when the switch comes back to APPS). */
  function forget() {
    shown = null
  }

  /** Clears our elements, without insisting: on exit. */
  async function clear() {
    if (touched)
      await bar.DisplayClear({ application_name: APPLICATION }, { timeout: TIMEOUT_MS }).catch(() => {})
  }

  return { paint, forget, clear }
}

/** Whether redrawing `after` over `before` would leave some of `before`'s
    settings behind. */
function morphs(before: Element, after: Element): boolean {
  const fill = (e: Element) => (e as { fill?: string }).fill
  return before.type !== after.type || fill(before) !== fill(after)
}

/** A bar error, in words a trainer can act on. */
export function describeBarError(error: unknown): string {
  const e = error as { status?: number, name?: string, message?: string }
  if (e.status === 409)
    return 'BUSY Bar refused to draw (409). Set the switch on the bar to APPS.'
  if (e.status === 403)
    return 'BUSY Bar denied access (403). Check BUSYBAR_PASSWORD in .env.local.'
  if (e.name === 'TimeoutError')
    return 'BUSY Bar not responding. The talk goes on without it; retrying every 5 s.'
  return `BUSY Bar unreachable (${e.message ?? String(error)}). The talk goes on without it; retrying every 5 s.`
}
