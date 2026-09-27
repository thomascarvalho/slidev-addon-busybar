/* The relay keeps the state (slide, timer, wheel setting) and the day, hands
   them to the renderers and has the painter put the scene on the bar. It
   knows neither Vite nor HTTP, so it can be tested with a fake bar.

   The talk must never depend on the bar: every call has a short timeout, only
   one paint is in flight at a time (the latest scene replaces pending ones),
   and a missing bar shows up as one log line, not as an error. */
import type { ResolvedConfig, SoundMoment } from './config.ts'
import type { Log } from './log.ts'
import type { DayStore, DayTrackerOptions } from './day.ts'
import type { Bar } from './painter.ts'
import type { RenderState, Scene } from './render.ts'
import type { Sound, SoundPlayer } from './sounds.ts'
import type { Timer, TimerAction } from './timer.ts'
import type { Schedule, SlideInfo } from './types.ts'
import { DEFAULT_SOUNDS, resolveConfig } from './config.ts'
import { createDayTracker } from './day.ts'
import { createPainter, describeBarError, TIMEOUT_MS } from './painter.ts'
import { renderBack } from './render-back.ts'
import { render } from './render.ts'
import { stockPlayer } from './sounds.ts'
import { act, adhoc, armed, remaining, status, WARN_MS } from './timer.ts'

export type { Bar } from './painter.ts'
export { TIMEOUT_MS } from './painter.ts'
export type { DayStore } from './day.ts'

const RETRY_MS = 5000
/** How long the wheel may go untouched before the setting closes. */
export const SETTING_MS = 15_000
/** The duration the wheel opens on, the first time. */
export const FIRST_SETTING_MS = 5 * 60_000
export const MIN_SETTING_MS = 60_000
export const MAX_SETTING_MS = 120 * 60_000

export type { Log } from './log.ts'

export interface RelayOptions {
  now?: () => number
  /** Resolves sounds to play; stock sounds only by default. */
  sounds?: SoundPlayer
  config?: ResolvedConfig
  store?: DayStore
  /** The grace timer of the day, injectable for tests. */
  timers?: DayTrackerOptions['timers']
}

export function createRelay(bar: Bar, log: Log, options: RelayOptions = {}) {
  const { now = Date.now, sounds = stockPlayer } = options
  let config = options.config ?? resolveConfig()
  const state: Omit<RenderState, 'schedule' | 'day'> = { slide: null, timer: null, setting: null }
  const painter = createPainter(bar, { debug: log.debug })
  const days = createDayTracker({
    now,
    timers: options.timers,
    store: options.store,
    grace: () => config.schedule.graceMs,
    onChange: (day) => {
      log.debug?.(`day: ${JSON.stringify(day)}`)
      void flush()
    },
  })
  let lastSlide = ''
  let lastSchedule = ''
  /* The duration the wheel reopens on: the first time, or the last one set. */
  let lastSettingMs = FIRST_SETTING_MS

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
    days.setSlide(slide)
    /* Changing slide acknowledges a finished timer; a running or waiting one
       carries on whatever the slide. */
    if (state.timer && status(state.timer, now()) === 'finished')
      state.timer = null
    void flush()
  }

  /** The deck's schedule, from the browser: once, then when the deck
      changes. Its warnings (unreadable values) are logged once. */
  function setSchedule(schedule: Schedule) {
    const key = JSON.stringify(schedule)
    if (key === lastSchedule)
      return
    lastSchedule = key
    for (const warning of schedule.warnings)
      log.warn(warning)
    days.setSchedule(schedule)
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
    /* With no timer to act on and nothing to arm, Start/Stop and cancel are
       the day's: "the day begins now", or forget a rehearsal. */
    if (!state.timer && !armed(state.slide, config)) {
      if (action === 'toggle' && days.start())
        return log.info('the day starts now.')
      if (action === 'cancel' && days.reset())
        return log.info('the day is reset.')
    }
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
    painter.forget()
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

  /** Both displays, as one scene: the front's LED, the earliest wake-up. */
  function scene(): Scene {
    const full: RenderState = { ...state, schedule: days.schedule, day: days.day }
    const front = render(full, now(), config)
    const back = renderBack(full, now(), config)
    return {
      elements: [...front.elements, ...back.elements],
      nextAt: front.nextAt === null ? back.nextAt : back.nextAt === null ? front.nextAt : Math.min(front.nextAt, back.nextAt),
      led: front.led,
    }
  }

  /** Paints the current scene, again until nothing changes (a paint takes
      time, and the state may have moved meanwhile). */
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
        const next = scene()
        nextAt = next.nextAt
        if (!await painter.paint(next))
          break
      }
      if (failing)
        log.info('BUSY Bar reachable again.')
      failing = false
    }
    catch (error) {
      painter.forget()
      if (!failing)
        log.warn(describeBarError(error))
      failing = true
      clearTimeout(retry)
      retry = setTimeout(() => void flush(), RETRY_MS)
    }
    finally {
      sending = false
    }
    /* When the bar fails, the 5 s retry takes over. The back's clock makes
       every scene tick once a minute: that timer must never keep a process
       alive (tests, `slidev export`). */
    if (nextAt !== null && !failing && !closed) {
      tick = setTimeout(() => void flush(), Math.max(0, nextAt - now()))
      tick.unref?.()
    }
  }

  /** Clears our elements on exit, without waiting or insisting. */
  async function close() {
    closed = true
    days.close()
    clearTimeout(retry)
    clearTimeout(tick)
    await painter.clear()
  }

  /* Right away: clears what a previous server left (a restart draws nothing
     until a page posts again, and Vite only reloads a visible page), and
     shows the clock, with the day loaded from the store. */
  void flush()

  return { setSlide, setSchedule, timer, setting: () => activeSetting() !== null, openSetting, adjust, startSetting, closeSetting, configure, redraw, close, flush }
}
