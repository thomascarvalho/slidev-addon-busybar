/* Activity timers. A timer lives in the relay, independently of the slide:
   going back a few slides during a workshop does not reset it. */
import type { Labels, ResolvedConfig } from './config.ts'
import type { Sound } from './sounds.ts'
import type { SlideInfo } from './types.ts'
import type { Phase } from './duration.ts'
import { parsePhases } from './duration.ts'
import { parseSound } from './sounds.ts'

export interface Timer {
  label: string
  /** Screen that dresses the timer (a break), `null` for an activity. */
  style: string | null
  /** At least one; a single one for a plain timer or a break. */
  phases: Phase[]
  /** The current phase. */
  index: number
  /** Length of the current phase, one more minute included. */
  totalMs: number
  /** When the current phase ends while running, `null` while paused. */
  endsAt: number | null
  /** Time left, frozen while paused. */
  leftMs: number
  /** The end sound has been played for the current phase. */
  rang: boolean
  /** The one-minute warning of a break has been played. */
  warned: boolean
  /** End sound given by the slide (`busy.sound`); absent: the deck's. */
  sound?: Sound
}

/** `waiting`: a phase is over and the next one waits for the trainer. */
export type Status = 'running' | 'paused' | 'waiting' | 'finished'

export type TimerAction = 'toggle' | 'add' | 'skip' | 'cancel'

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
    return timer.index < timer.phases.length - 1 ? 'waiting' : 'finished'
  return timer.endsAt === null ? 'paused' : 'running'
}

/** "Reading", or "Phase 3" when unnamed. */
export function phaseName(timer: { phases: Phase[] }, index: number, labels: Labels): string {
  return timer.phases[index]?.label ?? `${labels.phase} ${index + 1}`
}

/** What the current slide offers to start, without starting it. On a
    screen slide, a break: dressed by the screen, named after it, in one
    phase. */
export function armed(slide: SlideInfo | null, names: Names): { label: string, style: string | null, phases: Phase[], sound?: Sound } | null {
  const phases = slide?.timer ? parsePhases(slide.timer) : null
  if (!slide || !phases)
    return null
  /* An unreadable value keeps the deck's sound. */
  const own = slide.sound === null ? undefined : parseSound(slide.sound)
  const sound = own === undefined ? {} : { sound: own }
  if (slide.screen)
    return { label: slide.text ?? names.screens[slide.screen]?.title ?? slide.screen, style: slide.screen, phases: phases.slice(0, 1), ...sound }
  return { label: slide.activity ?? names.labels.timer, style: null, phases, ...sound }
}

/** Starts phase `index`. */
function begin(timer: Omit<Timer, 'index' | 'totalMs' | 'endsAt' | 'leftMs' | 'rang' | 'warned'>, index: number, now: number): Timer {
  const ms = timer.phases[index].ms
  /* A phase this short is already within its last minute: warn right away
     rather than never (the warning only fires on the way past WARN_MS). */
  return { ...timer, index, totalMs: ms, endsAt: now + ms, leftMs: 0, rang: false, warned: ms <= WARN_MS }
}

/**
 * - `toggle`: starts the slide's activity, pauses, resumes; starts the next
 *   phase; acknowledges a finished timer.
 * - `add`: one more minute, including to a phase that just ended.
 * - `skip`: ends the current phase now; starts the next one when waiting.
 * - `cancel`: drops the timer.
 */
export function act(timer: Timer | null, action: TimerAction, slide: SlideInfo | null, now: number, names: Names): Timer | null {
  if (action === 'cancel')
    return null

  if (!timer) {
    const next = action === 'toggle' ? armed(slide, names) : null
    return next && begin(next, 0, now)
  }

  const left = remaining(timer, now)
  const current = status(timer, now)
  if (action === 'add') {
    const base = Math.max(0, left)
    /* The warning plays again only if the minute brings it back above. */
    const warned = base + MINUTE <= WARN_MS
    return timer.endsAt === null && left > 0
      ? { ...timer, totalMs: timer.totalMs + MINUTE, leftMs: base + MINUTE, warned }
      : { ...timer, totalMs: timer.totalMs + MINUTE, endsAt: now + base + MINUTE, rang: false, warned }
  }

  if (action === 'skip') {
    switch (current) {
      case 'running':
      case 'paused': return { ...timer, endsAt: now, leftMs: 0 }
      case 'waiting': return begin(timer, timer.index + 1, now)
      case 'finished': return timer
    }
  }

  /* A break slide's Start/Stop starts the break, even over a workshop still
     running, paused or waiting elsewhere: the bar just showed what this
     press would do (see render()). A break already running under the same
     screen keeps the toggle below (pause, resume, dismiss). */
  const ready = armed(slide, names)
  if (ready?.style && ready.style !== timer.style)
    return begin(ready, 0, now)

  switch (current) {
    case 'finished': return null
    case 'waiting': return begin(timer, timer.index + 1, now)
    case 'running': return { ...timer, endsAt: null, leftMs: left }
    case 'paused': return { ...timer, endsAt: now + left }
  }
}
