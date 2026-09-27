/* The day, alive: the deck's schedule, the actual start, the steps entered,
   and the grace before a step counts as entered. It knows neither the bar nor
   Slidev: the relay tells it the slide shown and asks it to start or reset,
   and it calls back when the day changes (so that the relay redraws).

   The maths (planned times, delay, what comes next) are in `schedule.ts`;
   this module only keeps the state and its timing. */
import type { Day } from './schedule.ts'
import type { Schedule, SlideInfo } from './types.ts'
import { current, EMPTY_DAY, enter, startDay, stepOf } from './schedule.ts'

/** Where the day survives a restart of the dev server (`.busybar-day.json`). */
export interface DayStore {
  load: () => Day | null
  save: (day: Day) => unknown
}

export interface DayTrackerOptions {
  now?: () => number
  /** The grace timer, injectable for tests. */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown, clearTimeout: (handle: unknown) => void }
  /** How long a slide must stay before its step counts as entered; read
      when the grace is armed, so that a reloaded config applies. */
  grace: () => number
  store?: DayStore
  /** The day changed: entered a step, started, reset. */
  onChange?: (day: Day) => void
}

export interface DayTracker {
  readonly day: Day
  readonly schedule: Schedule | null
  setSchedule: (schedule: Schedule) => void
  setSlide: (slide: SlideInfo | null) => void
  /** "The day begins now"; `false` when a step is already entered. */
  start: () => boolean
  /** Forgets a rehearsal earlier in the day; `false` when there is nothing to forget. */
  reset: () => boolean
  close: () => void
}

export function createDayTracker(options: DayTrackerOptions): DayTracker {
  const { now = Date.now, store, grace, onChange } = options
  const timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  let day: Day = store?.load() ?? EMPTY_DAY
  let schedule: Schedule | null = null
  let slide: SlideInfo | null = null
  /* A step whose slide is shown, but not yet for the grace. */
  let pending: { step: number, handle: unknown } | null = null

  function set(next: Day) {
    if (next === day)
      return
    day = next
    void store?.save(day)
    onChange?.(day)
  }

  /** The deck's schedule: once, then whenever the deck changes. Entries are
      keyed by step, so they survive a re-indexed deck. */
  function setSchedule(next: Schedule) {
    schedule = next
    cancel()
    watch()
  }

  /** The slide shown: arms the grace when it belongs to a step later than
      the current one. */
  function setSlide(next: SlideInfo | null) {
    slide = next
    watch()
  }

  /** Arms the grace; a slide change before it fires cancels or re-arms it.
      The entry time is the time the slide was reached. */
  function watch() {
    if (!schedule || !slide)
      return cancel()
    const step = stepOf(schedule, slide.no)
    if (step <= current(schedule, day))
      return cancel()
    if (pending?.step === step)
      return
    cancel()
    const since = now()
    pending = {
      step,
      handle: timers.setTimeout(() => {
        pending = null
        if (schedule)
          set(enter(schedule, day, step, since))
      }, grace()),
    }
  }

  function cancel() {
    if (!pending)
      return
    timers.clearTimeout(pending.handle)
    pending = null
  }

  /** "The day begins now": before any step is entered, with a schedule that
      has steps. Pressing again moves the start again. */
  function start(): boolean {
    if (!schedule?.steps.length || current(schedule, day) >= 0)
      return false
    set(startDay(day, now()))
    return true
  }

  /** Forgets a rehearsal earlier in the day: on a slide before the first
      step, when there is a day to forget. */
  function reset(): boolean {
    if (!schedule?.steps.length || !slide || stepOf(schedule, slide.no) >= 0)
      return false
    if (day.startedAt === null && !Object.keys(day.entered).length)
      return false
    cancel()
    set(EMPTY_DAY)
    return true
  }

  return {
    get day() {
      return day
    },
    get schedule() {
      return schedule
    },
    setSchedule,
    setSlide,
    start,
    reset,
    close: cancel,
  }
}
