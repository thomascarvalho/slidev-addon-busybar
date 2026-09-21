/* Activity timers. A timer lives in the relay, independently of the slide:
   going back a few slides during a workshop does not reset it. */
import type { SlideInfo } from './types.ts'
import { parseDuration } from './duration.ts'

export interface Timer {
  label: string
  totalMs: number
  /** When it ends while running, `null` while paused. */
  endsAt: number | null
  /** Time left, frozen while paused. */
  leftMs: number
  /** The end sound has been played. */
  rang: boolean
}

export type Phase = 'running' | 'paused' | 'finished'

export type TimerAction = 'toggle' | 'cancel' | 'add'

const MINUTE = 60_000

export function remaining(timer: Timer, now: number): number {
  return timer.endsAt === null ? timer.leftMs : timer.endsAt - now
}

export function phase(timer: Timer, now: number): Phase {
  if (remaining(timer, now) <= 0)
    return 'finished'
  return timer.endsAt === null ? 'paused' : 'running'
}

/** The activity the current slide offers to start, without starting it. */
export function armed(slide: SlideInfo | null, defaultLabel: string): { label: string, totalMs: number } | null {
  const totalMs = slide?.timer ? parseDuration(slide.timer) : null
  if (!totalMs)
    return null
  return { label: slide?.activity ?? defaultLabel, totalMs }
}

/**
 * - `toggle`: starts the slide's activity, pauses, resumes; acknowledges a
 *   finished timer.
 * - `add`: one more minute, including to a finished timer.
 * - `cancel`: drops the timer.
 */
export function act(timer: Timer | null, action: TimerAction, slide: SlideInfo | null, now: number, defaultLabel: string): Timer | null {
  if (action === 'cancel')
    return null

  if (!timer) {
    const next = action === 'toggle' ? armed(slide, defaultLabel) : null
    return next && { ...next, endsAt: now + next.totalMs, leftMs: 0, rang: false }
  }

  const left = remaining(timer, now)
  if (action === 'add') {
    const base = Math.max(0, left)
    return timer.endsAt === null && left > 0
      ? { ...timer, totalMs: timer.totalMs + MINUTE, leftMs: base + MINUTE }
      : { ...timer, totalMs: timer.totalMs + MINUTE, endsAt: now + base + MINUTE, rang: false }
  }

  switch (phase(timer, now)) {
    case 'finished': return null
    case 'running': return { ...timer, endsAt: null, leftMs: left }
    case 'paused': return { ...timer, endsAt: now + left }
  }
}
