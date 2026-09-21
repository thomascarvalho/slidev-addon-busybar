/* The relay keeps the state, hands it to the renderer and pushes the scene to
   the bar. It knows neither Vite nor HTTP, so it can be tested with a fake
   bar.

   The talk must never depend on the bar: every call has a short timeout, only
   one call is in flight at a time (the latest scene replaces pending ones),
   and a missing bar shows up as one log line, not as an error. */
import type { AudioPlayParams, DisplayClearParams, DisplayDrawParams, RequestOptions, SuccessResponse } from '@busy-app/busy-lib'
import type { ResolvedConfig } from './config.ts'
import type { RenderState } from './render.ts'
import type { TimerAction } from './timer.ts'
import type { Element, SlideInfo } from './types.ts'
import { resolveConfig } from './config.ts'
import { render } from './render.ts'
import { act, phase } from './timer.ts'

export const APPLICATION = 'slidev'
const PRIORITY = 50
export const TIMEOUT_MS = 1500
const RETRY_MS = 5000

/* Firmware sound played when a timer runs out. */
export const DEFAULT_SOUND = 'shared/calendar_reminder_ends.wav'

/** What the relay needs from a `BusyBar` client. */
export interface Bar {
  DisplayDraw: (params: DisplayDrawParams, options?: RequestOptions) => Promise<SuccessResponse>
  DisplayClear: (params?: DisplayClearParams, options?: RequestOptions) => Promise<SuccessResponse>
  AudioPlay: (params: AudioPlayParams, options?: RequestOptions) => Promise<SuccessResponse>
}

export interface Log {
  info: (message: string) => void
  warn: (message: string) => void
  /** Every call to the bar, with `BUSYBAR_DEBUG=true`. */
  debug?: (message: string) => void
}

export interface RelayOptions {
  now?: () => number
  /** `stock_path` of the end sound; empty for none. */
  sound?: string
  config?: ResolvedConfig
}

export function createRelay(bar: Bar, log: Log, options: RelayOptions = {}) {
  const { now = Date.now, sound = DEFAULT_SOUND } = options
  let config = options.config ?? resolveConfig()
  const state: RenderState = { slide: null, timer: null }
  let lastSlide = ''

  /* What the bar shows, by element id; `null` when we do not know (at start,
     after a failure), which forces a full clear: a server killed abruptly may
     have left its elements on screen. */
  let shown: Map<string, string> | null = null
  /* LED colour requested by the last draw. */
  let shownLed: string | undefined
  let sending = false
  let failing = false
  let retry: ReturnType<typeof setTimeout> | undefined
  /* Next render of a scene that changes on its own (countdown, blinking). */
  let tick: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function setSlide(slide: SlideInfo) {
    /* Audience and presenter windows both send the same slide. */
    const key = JSON.stringify(slide)
    if (key === lastSlide)
      return
    lastSlide = key
    state.slide = slide
    /* Changing slide acknowledges a finished timer; a running one carries on
       whatever the slide. */
    if (state.timer && phase(state.timer, now()) === 'finished')
      state.timer = null
    void flush()
  }

  function timer(action: TimerAction) {
    state.timer = act(state.timer, action, state.slide, now(), config.labels.timer)
    log.debug?.(`timer: ${action}`)
    void flush()
  }

  /** Swaps the configuration (after `busybar.config.ts` changed). */
  function configure(next: ResolvedConfig) {
    config = next
    void flush()
  }

  /** Plays the end sound once per timer, without waiting for the bar. */
  function ring() {
    const t = state.timer
    if (!t || t.rang || phase(t, now()) !== 'finished')
      return
    state.timer = { ...t, rang: true }
    if (sound) {
      bar.AudioPlay({ application_name: APPLICATION, stock_path: sound }, { timeout: TIMEOUT_MS })
        .catch(error => log.debug?.(`end sound not played: ${(error as Error).message}`))
    }
  }

  async function flush() {
    if (sending || closed)
      return
    sending = true
    clearTimeout(tick)
    let nextAt: number | null = null
    try {
      for (;;) {
        ring()
        const scene = render(state, now(), config)
        nextAt = scene.nextAt
        const elements = scene.elements
        const changed = elements.filter(e => shown?.get(e.id) !== JSON.stringify(e))
        const removed = shown ? [...shown.keys()].filter(id => !elements.some(e => e.id === id)) : []
        /* The LED is set by a draw: draw again if only the LED changes. */
        if (scene.led !== shownLed && !changed.length && elements.length)
          changed.push(elements[0])
        if (shown && !changed.length && !removed.length)
          break
        await send(changed, removed, scene.led)
        shown = new Map(elements.map(e => [e.id, JSON.stringify(e)]))
        shownLed = scene.led
      }
      if (failing)
        log.info('BUSY Bar reachable again.')
      failing = false
    }
    catch (error) {
      shown = null
      if (!failing)
        log.warn(describe(error))
      failing = true
      clearTimeout(retry)
      retry = setTimeout(() => void flush(), RETRY_MS)
    }
    finally {
      sending = false
    }
    /* When the bar fails, the 5 s retry takes over. */
    if (nextAt !== null && !failing && !closed)
      tick = setTimeout(() => void flush(), Math.max(0, nextAt - now()))
  }

  async function send(changed: Element[], removed: string[], led?: string) {
    log.debug?.(`${shown ? `clear [${removed}]` : 'clear all'}, draw [${changed.map(e => e.id)}]${led ? `, LED ${led}` : ''}`)
    const options = { timeout: TIMEOUT_MS }
    if (!shown)
      await bar.DisplayClear({ application_name: APPLICATION }, options)
    else if (removed.length)
      await bar.DisplayClear({ application_name: APPLICATION, element_ids: removed }, options)
    if (changed.length) {
      await bar.DisplayDraw({
        application_name: APPLICATION,
        priority: PRIORITY,
        elements: changed,
        ...(led ? { led_notification_color: led } : {}),
      }, options)
    }
  }

  /** Clears our elements on exit, without waiting or insisting. A relay that
      received nothing (the one of `slidev export`, say) leaves alone what
      another server shows. */
  async function close() {
    closed = true
    clearTimeout(retry)
    clearTimeout(tick)
    if (lastSlide)
      await bar.DisplayClear({ application_name: APPLICATION }, { timeout: TIMEOUT_MS }).catch(() => {})
  }

  return { setSlide, timer, configure, close, flush }
}

function describe(error: unknown): string {
  const e = error as { status?: number, name?: string, message?: string }
  if (e.status === 409)
    return 'BUSY Bar refused to draw (409). Set the switch on the bar to APPS.'
  if (e.status === 403)
    return 'BUSY Bar denied access (403). Check BUSYBAR_PASSWORD in .env.local.'
  if (e.name === 'TimeoutError')
    return 'BUSY Bar not responding. The talk goes on without it; retrying every 5 s.'
  return `BUSY Bar unreachable (${e.message ?? String(error)}). The talk goes on without it; retrying every 5 s.`
}
