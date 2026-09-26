/* Browser side: we know every slide, so we work out the current chapter and
   where the slide sits in it. */
import type { Schedule, SlideInfo, Step } from './types.ts'
import { parseClock, parseDuration, parsePhases } from './duration.ts'

/** The `busy` block of a slide's frontmatter. */
export interface BusyFrontmatter {
  chapter?: unknown
  activity?: unknown
  timer?: unknown
  screen?: unknown
  until?: unknown
  text?: unknown
  sound?: unknown
  /** Schedule keys (see `schedule()`); `start` and `end` in the headmatter. */
  duration?: unknown
  at?: unknown
  start?: unknown
  end?: unknown
}

function str(value: unknown): string | null {
  if (typeof value === 'number')
    return String(value)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/* Matches the server's own cap (`parseSlide` in plugin.ts), which is the
   actual trust boundary; this one only keeps the browser's phase list
   consistent with what the server will accept. */
const MAX_PHASES = 10

/** A value or a list of values → a list of strings, `null` if empty. */
function strs(value: unknown): string[] | null {
  const list = (Array.isArray(value) ? value : [value]).map(str).filter((s): s is string => s !== null)
  return list.length ? list : null
}

/**
 * @param busy the `busy` block of every slide, in deck order
 * @param current the index (from 0) of the current slide
 * @param title the title of the current slide, or of the deck
 */
export function slideInfo(busy: (BusyFrontmatter | undefined)[], current: number, title: string | null = null): SlideInfo {
  /* The current chapter is the last one declared at or before the current
     slide. A special screen (break, questions…) closes the chapter. */
  const opens = (i: number) => !!str(busy[i]?.chapter)
  const closes = (i: number) => opens(i) || !!str(busy[i]?.screen)
  let start = -1
  for (let i = current; i >= 0; i--) {
    if (closes(i)) {
      start = opens(i) ? i : -1
      break
    }
  }
  let end = busy.length
  for (let i = current + 1; i < busy.length; i++) {
    if (closes(i)) {
      end = i
      break
    }
  }

  const own = busy[current] ?? {}
  return {
    no: current + 1,
    title: str(title),
    chapter: start >= 0 ? str(busy[start]?.chapter) : null,
    chapterNo: start >= 0 ? busy.slice(0, start + 1).filter(b => str(b?.chapter)).length : null,
    progress: start >= 0 ? { index: current - start + 1, count: end - start } : null,
    activity: str(own.activity),
    timer: strs(own.timer)?.slice(0, MAX_PHASES) ?? null,
    screen: str(own.screen),
    until: str(own.until),
    text: str(own.text),
    sound: own.sound === false ? false : str(own.sound),
  }
}

/**
 * The day's schedule: one step per chapter with a `duration` or an `at`, and
 * per screen slide with a `duration`, a `timer` (its phases summed) or an
 * `at`. `start` and `end` come from the headmatter (slide 1). Unreadable
 * values are skipped and reported in `warnings`.
 */
export function schedule(busy: (BusyFrontmatter | undefined)[]): Schedule {
  const warnings: string[] = []
  const clock = (value: unknown, no: number, key: string): number | null => {
    const s = str(value)
    if (s === null)
      return null
    const minutes = parseClock(s)
    if (minutes === null)
      warnings.push(`slide ${no}: busy.${key} "${s}" is not a time (HH:MM)`)
    return minutes
  }
  const duration = (value: unknown, no: number): number | null => {
    const s = str(value)
    if (s === null)
      return null
    const ms = parseDuration(s)
    if (ms === null)
      warnings.push(`slide ${no}: busy.duration "${s}" is not a duration (45m, 1h30m)`)
    return ms
  }

  const head = busy[0] ?? {}
  const start = clock(head.start, 1, 'start')
  const end = clock(head.end, 1, 'end')
  const steps: Step[] = []
  busy.forEach((b, i) => {
    const chapter = str(b?.chapter)
    const screen = str(b?.screen)
    if (!b || (!chapter && !screen))
      return
    const no = i + 1
    const at = clock(b.at, no, 'at')
    let durationMs = duration(b.duration, no) ?? 0
    if (!durationMs && screen) {
      const phases = strs(b.timer)
      const parsed = phases && parsePhases(phases)
      durationMs = parsed ? parsed.reduce((sum, p) => sum + p.ms, 0) : 0
    }
    if (!durationMs && at === null)
      return
    steps.push({ from: no, kind: chapter ? 'chapter' : screen!, label: chapter ?? str(b.text), durationMs, at })
  })
  return { start, end, steps, warnings }
}
