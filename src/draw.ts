/* Small helpers to build `DisplayDraw` elements, used by the renderer and
   exported for custom logos in `busybar.config.ts`. */
import type { DeviceFont } from '@busy-app/busy-lib'
import type { Element } from './types.ts'
import { generateXpm2, registerFontMaps, SCREEN, textWidth } from '@busy-app/busy-lib'
import * as fonts from '@busy-app/busy-lib/fonts'
import { toBarColor } from './config.ts'

for (const map of Object.values(fonts))
  registerFontMaps(map)

export { SCREEN, textWidth }
export type { DeviceFont }

/** A filled rectangle. */
export function rect(id: string, x: number, y: number, width: number, height: number, color: string): Element {
  return { id, type: 'rectangle', x, y, width, height, fill: 'solid', fill_colors: [toBarColor(color)], border_width: 0 }
}

/**
 * Pixel art, one character per pixel. `.` is transparent; every other
 * character needs a colour in `palette`. At most 32 colours, and no larger
 * than the screen.
 *
 * ```ts
 * pixels('heart', ['.#.#.', '#####', '.###.', '..#..'], { '#': '#FF3030' }, 0, 6)
 * ```
 */
export function pixels(id: string, grid: string[], palette: Record<string, string>, x = 0, y = 0): Element {
  const colours: Record<string, string> = { '.': 'none' }
  for (const [symbol, colour] of Object.entries(palette))
    colours[symbol] = toBarColor(colour).slice(0, 7)
  return { id, type: 'xpmbitmap', data: generateXpm2({ palette: colours, grid }), x, y }
}

/** Text in one of the bar's fonts, its top-left corner at (x, y). */
export function label(id: string, text: string, font: DeviceFont, color: string, x: number, y: number): Element {
  return { id, type: 'text', text, font, color: toBarColor(color), x, y, align: 'top_left' }
}

/* 3×5 digits, scaled: big numbers the bar's fonts cannot draw (they top
   out at 12 px). Used on the back display for the clock and countdowns. */
const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
}

/** Width in pixels of `text` drawn by `digits` at `scale`. */
export function digitsWidth(text: string, scale: number): number {
  return text.length ? (text.length * 4 - 1) * scale : 0
}

/** `text` (digits, `:`, `+`, `-`) as one pixel-art element, `scale` pixels
    per dot, its top-left (or top-right with `align: 'right'`) at (x, y). */
export function digits(id: string, text: string, color: string, x: number, y: number, scale = 3, align: 'left' | 'right' = 'left'): Element {
  const rows = Array.from({ length: 5 }, (_, r) => [...text].map(c => (GLYPHS[c] ?? GLYPHS[' '])[r]).join('.'))
  const grid = rows.flatMap(row => Array.from({ length: scale }, () => [...row].flatMap(c => Array.from({ length: scale }, () => c)).join('')))
  const left = align === 'right' ? x - digitsWidth(text, scale) : x
  return pixels(id, grid, { '#': color }, left, y)
}
