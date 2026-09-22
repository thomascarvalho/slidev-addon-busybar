/* The relay keeps the state, hands it to the renderer and pushes the scene to
   the bar. It knows neither Vite nor HTTP, so it can be tested with a fake
   bar.

   The talk must never depend on the bar: every call has a short timeout, only
   one call is in flight at a time (the latest scene replaces pending ones),
   and a missing bar shows up as one log line, not as an error. */
import type { AudioPlayParams, DisplayClearParams, DisplayDrawParams, RequestOptions, SuccessResponse } from '@busy-app/busy-lib'
import type { ResolvedConfig, SoundMoment } from './config.ts'
import type { RenderState } from './render.ts'
import type { Sound, SoundPlayer } from './sounds.ts'
import type { Timer, TimerAction } from './timer.ts'
import type { Element, SlideInfo } from './types.ts'
import { DEFAULT_SOUNDS, resolveConfig } from './config.ts'
import { render } from './render.ts'
import { APPLICATION, stockPlayer } from './sounds.ts'
import { act, adhoc, remaining, status, WARN_MS } from './timer.ts'

const PRIORITY = 50
export const TIMEOUT_MS = 1500
const RETRY_MS = 5000
/** How long the wheel may go untouched before the setting closes. */
export const SETTING_MS = 15_000
/** The duration the wheel opens on, the first time. */
export const FIRST_SETTING_MS = 5 * 60_000
export const MIN_SETTING_MS = 60_000
export const MAX_SETTING_MS = 120 * 60_000

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
  /** Resolves sounds to play; stock sounds only by default. */
  sounds?: SoundPlayer
  config?: ResolvedConfig
}

export function createRelay(bar: Bar, log: Log, options: RelayOptions = {}) {
  const { now = Date.now, sounds = stockPlayer } = options
  let config = options.config ?? resolveConfig()
  const state: RenderState = { slide: null, timer: null, setting: null }
  let lastSlide = ''
  /* The duration the wheel reopens on: the first time, or the last one set. */
  let lastSettingMs = FIRST_SETTING_MS

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
    /* Changing slide acknowledges a finished timer; a running or waiting one
       carries on whatever the slide. */
    if (state.timer && status(state.timer, now()) === 'finished')
      state.timer = null
    void flush()
  }

  /** Swaps the timer, playing the start sound when a timer or a phase
      starts (not on resume, not on one more minute). */
  function replace(next: Timer | null) {
    const before = state.timer
    state.timer = next
    if (next && status(next, now()) === 'running' && (!before || next.phases !== before.phases || next.index !== before.index))
      play('start')
    void flush()
  }

  function timer(action: TimerAction) {
    log.debug?.(`timer: ${action}`)
    replace(act(state.timer, action, state.slide, now(), config))
  }

  /** The setting, or `null` once it has expired: honoured directly, without
      waiting for `flush()` to notice (the bar may be failing). */
  function activeSetting() {
    return state.setting && now() < state.setting.until ? state.setting : null
  }

  /** Opens the wheel on the last duration set, or 5 min the first time. */
  function openSetting() {
    state.setting = { ms: lastSettingMs, until: now() + SETTING_MS }
    void flush()
  }

  /** Moves the wheel by `delta` minutes, clamped to 1..120 min. */
  function adjust(delta: number) {
    const setting = activeSetting()
    if (!setting)
      return
    const ms = Math.min(MAX_SETTING_MS, Math.max(MIN_SETTING_MS, setting.ms + delta * 60_000))
    state.setting = { ms, until: now() + SETTING_MS }
    void flush()
  }

  /** Starts the set duration as an ad-hoc timer, closing the wheel. */
  function startSetting() {
    const setting = activeSetting()
    if (!setting)
      return
    lastSettingMs = setting.ms
    state.setting = null
    replace(adhoc(lastSettingMs, now(), config))
  }

  /** Closes the setting, starting nothing. */
  function closeSetting() {
    state.setting = null
    void flush()
  }

  /** Swaps the configuration (after `busybar.config.ts` changed). */
  function configure(next: ResolvedConfig) {
    config = next
    void flush()
  }

  /** Draws everything again at once, without waiting for the 5 s retry:
      the switch on the bar just came back to APPS. */
  function redraw() {
    shown = null
    clearTimeout(retry)
    void flush()
  }

  /** Plays a break's warning once, then the end sound once per phase,
      without waiting for the bar. */
  function ring() {
    const t = state.timer
    if (!t)
      return
    const s = status(t, now())
    if (t.style && !t.warned && s === 'running' && remaining(t, now()) <= WARN_MS) {
      state.timer = { ...t, warned: true }
      play('breakWarning')
    }
    const current = state.timer!
    if (current.rang || (s !== 'finished' && s !== 'waiting'))
      return
    state.timer = { ...current, rang: true }
    play(s === 'waiting' ? 'phaseEnd' : current.style ? 'breakOver' : 'timeUp', current.sound)
  }

  /** Plays a moment's sound: the timer's own (end moments), else the
      deck's; the default when a file is not ready. */
  function play(moment: SoundMoment, own?: Sound) {
    const params = sounds.resolve(own !== undefined ? own : config.sounds[moment], DEFAULT_SOUNDS[moment])
    if (!params)
      return
    bar.AudioPlay(params, { timeout: TIMEOUT_MS })
      .catch(error => log.debug?.(`sound not played: ${(error as Error).message}`))
  }

  async function flush() {
    if (sending || closed)
      return
    sending = true
    clearTimeout(tick)
    let nextAt: number | null = null
    try {
      for (;;) {
        state.setting = activeSetting()
        ring()
        const scene = render(state, now(), config)
        nextAt = scene.nextAt
        const elements = scene.elements
        const changed = elements.filter(e => shown?.get(e.id) !== JSON.stringify(e))
        const removed = shown ? [...shown.keys()].filter(id => !elements.some(e => e.id === id)) : []
        /* Drawing again under the same id merges fields rather than replacing
           the element: a rectangle keeps its gradient when redrawn solid. So
           an element that changes kind is cleared first. */
        for (const e of changed) {
          const before = shown?.get(e.id)
          if (before && morphs(JSON.parse(before), e))
            removed.push(e.id)
        }
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

  return { setSlide, timer, setting: () => activeSetting() !== null, openSetting, adjust, startSetting, closeSetting, configure, redraw, close, flush }
}

/** Whether redrawing `after` over `before` would leave some of `before`'s
    settings behind. */
function morphs(before: Element, after: Element): boolean {
  const fill = (e: Element) => (e as { fill?: string }).fill
  return before.type !== after.type || fill(before) !== fill(after)
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
