/* Activity timers. A timer lives in the relay, independently of the slide:
   going back a few slides during a workshop does not reset it. */
import type { ResolvedConfig } from './config.ts'
import type { SlideInfo } from './types.ts'
import { parseDuration } from './duration.ts'

export interface Timer {
  label: string
  /** Screen that dresses the timer (a break), `null` for an activity. */
  style: string | null
  totalMs: number
  /** When it ends while running, `null` while paused. */
  endsAt: number | null
  /** Time left, frozen while paused. */
  leftMs: number
  /** The end sound has been played. */
  rang: boolean
  /** The one-minute warning of a break has been played. */
  warned: boolean
}

export type Status = 'running' | 'paused' | 'finished'

export type TimerAction = 'toggle' | 'cancel' | 'add'

/** What names a timer: the default activity name and the screens. */
export type Names = Pick<ResolvedConfig, 'labels' | 'screens'>

/** A break warns when this much time is left. */
export const WARN_MS = 60_000

const MINUTE = 60_000

export function remaining(timer: Timer, now: number): number {
  return timer.endsAt === null ? timer.leftMs : timer.endsAt - now
}

export function status(timer: Timer, now: number): Status {
  if (remaining(timer, now) <= 0)
    return 'finished'
  return timer.endsAt === null ? 'paused' : 'running'
}

/** What the current slide offers to start, without starting it. On a
    screen slide, a break: dressed by the screen and named after it. */
export function armed(slide: SlideInfo | null, names: Names): { label: string, style: string | null, totalMs: number } | null {
  const totalMs = slide?.timer ? parseDuration(slide.timer) : null
  if (!slide || !totalMs)
    return null
  if (slide.screen)
    return { label: slide.text ?? names.screens[slide.screen]?.title ?? slide.screen, style: slide.screen, totalMs }
  return { label: slide.activity ?? names.labels.timer, style: null, totalMs }
}

/**
 * - `toggle`: starts the slide's activity, pauses, resumes; acknowledges a
 *   finished timer.
 * - `add`: one more minute, including to a finished timer.
 * - `cancel`: drops the timer.
 */
export function act(timer: Timer | null, action: TimerAction, slide: SlideInfo | null, now: number, names: Names): Timer | null {
  if (action === 'cancel')
    return null

  if (!timer) {
    const next = action === 'toggle' ? armed(slide, names) : null
    return next && { ...next, endsAt: now + next.totalMs, leftMs: 0, rang: false, warned: false }
  }

  const left = remaining(timer, now)
  if (action === 'add') {
    const base = Math.max(0, left)
    /* The warning plays again only if the minute brings it back above. */
    const warned = base + MINUTE <= WARN_MS
    return timer.endsAt === null && left > 0
      ? { ...timer, totalMs: timer.totalMs + MINUTE, leftMs: base + MINUTE, warned }
      : { ...timer, totalMs: timer.totalMs + MINUTE, endsAt: now + base + MINUTE, rang: false, warned }
  }

  switch (status(timer, now)) {
    case 'finished': return null
    case 'running': return { ...timer, endsAt: null, leftMs: left }
    case 'paused': return { ...timer, endsAt: now + left }
  }
}
