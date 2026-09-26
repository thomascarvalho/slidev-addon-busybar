import type { DisplayDrawParams } from '@busy-app/busy-lib'

/** One element of a BUSY Bar `DisplayDraw` call. */
export type Element = DisplayDrawParams['elements'][number]

/* What the slides send to the relay on every slide change. Chapter and
   progress are computed in the browser, which knows every slide; the rest is
   copied from the `busy` frontmatter. */
export interface SlideInfo {
  no: number
  /** Title of the slide, or of the deck: shown outside any chapter. */
  title: string | null
  chapter: string | null
  /** Rank of the chapter in the deck, from 1: picks its colour. */
  chapterNo: number | null
  /** Position of the slide within its chapter, from 1. */
  progress: { index: number, count: number } | null
  activity: string | null
  /** The `busy.timer` phases, one entry each (`['5m Reading']`). */
  timer: string[] | null
  screen: string | null
  until: string | null
  text: string | null
  /** `busy.sound`: the end sound of this slide's timer; `false` silences it,
      `null` keeps the deck's. */
  sound: string | false | null
}

/* The day's schedule, derived from the deck in the browser (`slides.ts`)
   and sent to the relay once, then whenever the deck changes. */
export interface Step {
  /** Number of the step's first slide, from 1. A step spans up to the next
      step's first slide. */
  from: number
  /** `chapter`, or the screen's name (`break`, `questions`, a logo…). */
  kind: string
  /** The chapter's title, or the screen's `text`; `null` for a screen
      without `text` (named after `screens.<kind>.title` when shown). */
  label: string | null
  /** 0 for a step with `at` alone. */
  durationMs: number
  /** Planned start, minutes since midnight, when anchored with `at`. */
  at: number | null
}

export interface Schedule {
  /** `busy.start` and `busy.end` of the headmatter, minutes since midnight. */
  start: number | null
  end: number | null
  steps: Step[]
  /** Unreadable values, one line each, for the server's console. */
  warnings: string[]
}
