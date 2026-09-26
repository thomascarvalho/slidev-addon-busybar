/* The day's schedule, alive: which step is current, how late we are, what
   comes next. Pure: `now` is a parameter, times are ms timestamps, and the
   day is local (`start`, `end` and `at` are minutes since midnight). */
import type { Schedule, Step } from './types.ts'

const MINUTE = 60_000

/** What the relay keeps (and saves) about the day. */
export interface Day {
  /** Actual start of the day; `null` until known. */
  startedAt: number | null
  /** Entry time of each step, by key (see `stepKeys`). */
  entered: Record<string, number>
}

export const EMPTY_DAY: Day = { startedAt: null, entered: {} }

export interface Planned {
  step: Step
  key: string
  startsAt: number
  endsAt: number
}

export interface Status {
  /** The current step, `null` before the first one. */
  current: Planned | null
  enteredAt: number | null
  /** Whole minutes, positive when late; `null` before the first step. */
  delay: number | null
  /** ms, negative once overrun; `null` before the first step or for a
      zero-length step. */
  remaining: number | null
  /** The step after the current one (the first one before any is entered);
      `at` is `null` while the origin is unknown. */
  next: { step: Step, at: number | null } | null
}

/** Midnight of `ref`'s local day. */
function midnight(ref: number): number {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The timestamp of `minutes` past midnight on `ref`'s day. */
export function clockMs(minutes: number, ref: number): number {
  return midnight(ref) + minutes * MINUTE
}

/** Minutes since midnight of `ms`, fractional. */
export function minutesOfDay(ms: number): number {
  return (ms - midnight(ms)) / MINUTE
}

/** One key per step: kind and label, numbered when two steps share them,
    so that entries survive slides inserted or removed during the day. */
export function stepKeys(schedule: Schedule): string[] {
  const seen = new Map<string, number>()
  return schedule.steps.map((step) => {
    const base = `${step.kind}:${step.label ?? ''}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}#${n}`
  })
}

/** Index of the step `slideNo` belongs to: the last one starting at or
    before it; −1 before the first. */
export function stepOf(schedule: Schedule, slideNo: number): number {
  let index = -1
  schedule.steps.forEach((step, i) => {
    if (step.from <= slideNo)
      index = i
  })
  return index
}

/** Index of the furthest step entered, −1 when none. */
export function current(schedule: Schedule, day: Day): number {
  let index = -1
  stepKeys(schedule).forEach((key, i) => {
    if (key in day.entered)
      index = i
  })
  return index
}

/** The origin of the chain: the actual start, else the deck's `start` on
    `ref`'s day, else the earliest entry (a day loaded without its start),
    else `null`. */
export function origin(schedule: Schedule, day: Day, ref: number): number | null {
  if (day.startedAt !== null)
    return day.startedAt
  if (schedule.start !== null)
    return clockMs(schedule.start, ref)
  const entries = Object.values(day.entered)
  return entries.length ? Math.min(...entries) : null
}

/** Planned start and end of every step: an anchor as written, the others
    chained from the origin. */
export function plan(schedule: Schedule, origin: number): Planned[] {
  const keys = stepKeys(schedule)
  const out: Planned[] = []
  schedule.steps.forEach((step, i) => {
    const startsAt = step.at !== null ? clockMs(step.at, origin) : (out[i - 1]?.endsAt ?? origin)
    out.push({ step, key: keys[i], startsAt, endsAt: startsAt + step.durationMs })
  })
  return out
}

/** Enters step `index` at `at`. The first entry also starts the day, at the
    deck's `start` when it has one. A step already entered stays as it was. */
export function enter(schedule: Schedule, day: Day, index: number, at: number): Day {
  const key = stepKeys(schedule)[index]
  if (key === undefined || key in day.entered)
    return day
  const startedAt = day.startedAt ?? (schedule.start === null ? at : clockMs(schedule.start, at))
  return { startedAt, entered: { ...day.entered, [key]: at } }
}

/** "The day begins now": Start/Stop on the welcome slide. */
export function startDay(day: Day, at: number): Day {
  return { ...day, startedAt: at }
}

const NONE: Status = { current: null, enteredAt: null, delay: null, remaining: null, next: null }

export function status(schedule: Schedule | null, day: Day, now: number): Status {
  if (!schedule || !schedule.steps.length)
    return NONE
  const from = origin(schedule, day, now)
  const planned = from === null ? null : plan(schedule, from)
  const index = current(schedule, day)
  if (index < 0)
    return { ...NONE, next: { step: schedule.steps[0], at: planned?.[0].startsAt ?? null } }
  /* Entered, so the day has started and the plan is known. */
  const cur = planned![index]
  const enteredAt = day.entered[cur.key]
  const duration = cur.step.durationMs
  const overrun = Math.max(0, now - enteredAt - duration)
  const delay = Math.round((enteredAt + duration - cur.endsAt + overrun) / MINUTE) || 0
  const after = planned![index + 1]
  return {
    current: cur,
    enteredAt,
    delay,
    remaining: duration > 0 ? duration - (now - enteredAt) : null,
    next: after ? { step: after.step, at: after.startsAt } : null,
  }
}

/** For the front of a screen slide: when the room is back. A break (a
    screen step with a duration): its end, actual once entered, planned
    otherwise. Any other slide: the planned start of the next step. */
export function resumeTime(schedule: Schedule | null, day: Day, now: number, slideNo: number): number | null {
  if (!schedule)
    return null
  const from = origin(schedule, day, now)
  if (from === null)
    return null
  const planned = plan(schedule, from)
  const index = stepOf(schedule, slideNo)
  const step = planned[index]
  if (step && step.step.kind !== 'chapter' && step.step.durationMs > 0) {
    const enteredAt = day.entered[step.key]
    return enteredAt === undefined ? step.endsAt : enteredAt + step.step.durationMs
  }
  return planned[index + 1]?.startsAt ?? null
}
