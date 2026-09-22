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
}
