/* Browser side: we know every slide, so we work out the current chapter and
   where the slide sits in it. */
import type { SlideInfo } from './types.ts'

/** The `busy` block of a slide's frontmatter. */
export interface BusyFrontmatter {
  chapter?: unknown
  activity?: unknown
  timer?: unknown
  screen?: unknown
  until?: unknown
  text?: unknown
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
  }
}
