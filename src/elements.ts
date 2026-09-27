/* Drawing primitives shared by the front and the back renderers: text that
   scrolls when it does not fit, and progress lines, plain or in segments.
   Each takes the room it may use, so that the same code serves a 72×16
   screen with 1-px rows and a 160×80 one with 2-px lines. */
import type { DeviceFont } from '@busy-app/busy-lib'
import type { Element } from './types.ts'
import { textWidth } from './draw.ts'
import { toDeviceText } from './text.ts'

/* The bar's native scrolling, in pixels per minute. */
const SCROLL = { scroll_rate: 900, scroll_start_delay: 1500, scroll_repeat_delay: 2000 }

export interface Room {
  /** Left edge and width of the room the text may use. */
  x: number
  width: number
  y: number
}

/** `value` within its room: anchored left, centred or right when it fits,
    scrolling from the left otherwise. */
export function fit(id: string, value: string, font: DeviceFont, color: string, room: Room, align: 'left' | 'mid' | 'right'): Element {
  const content = toDeviceText(value)
  const { x, y, width } = room
  if (textWidth(content, font) <= width) {
    const anchor = align === 'left' ? { x, align: 'top_left' as const } : align === 'mid' ? { x: x + Math.floor(width / 2), align: 'top_mid' as const } : { x: x + width, align: 'top_right' as const }
    return { id, type: 'text', text: content, font, color, x: anchor.x, y, align: anchor.align }
  }
  return { id, type: 'text', text: content, font, color, x, y, align: 'top_left', width, ...SCROLL }
}

export interface Line {
  x: number
  y: number
  width: number
  height: number
  /** Colour of the empty part. */
  track: string
  /** Dark pixels between two segments. */
  gap: number
}

/** A colour, or a horizontal gradient from the first to the second. */
export type Fill = string | [string, string]

/** Ids: `track`, `fill`, `seg2`… on their own, or after `prefix-`. */
const name = (prefix: string, part: string) => prefix ? `${prefix}-${part}` : part

function rect(id: string, x: number, y: number, width: number, height: number, fill: Fill, z_index: number): Element {
  const colors = typeof fill === 'string'
    ? { fill: 'solid' as const, fill_colors: [fill] }
    : { fill: 'gradient_h' as const, fill_colors: [...fill] }
  return { id, type: 'rectangle', x, y, width, height, ...colors, border_width: 0, z_index }
}

/** A line filled to `ratio` (0 to 1). The track's explicit `z_index: 0`
    matters: without it, firmware 1.2.4 draws the track over the fill
    whenever a text element comes first. */
export function line(prefix: string, geometry: Line, ratio: number, fill: Fill): Element[] {
  const { x, y, width, height, track } = geometry
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  const elements = [rect(name(prefix, 'track'), x, y, width, height, track, 0)]
  if (filled > 0)
    elements.push(rect(name(prefix, 'fill'), x, y, filled, height, fill, 1))
  return elements
}

/** One segment per phase, a dark gap between: `done` phases full in
    `doneFill`, the current one (if any) filled to `ratio`, the rest left as
    the track. */
export function segments(prefix: string, geometry: Line, count: number, done: number, current: { ratio: number, fill: Fill } | null, doneFill: string): Element[] {
  const { x, y, width, height, track, gap } = geometry
  const each = Math.floor((width - gap * (count - 1)) / count)
  const elements = [rect(name(prefix, 'track'), x, y, width, height, track, 0)]
  for (let i = 0; i < count; i++) {
    const left = x + i * (each + gap)
    const full = i === count - 1 ? x + width - left : each
    if (i > 0)
      elements.push(rect(name(prefix, `gap${i}`), left - gap, y, gap, height, '#000000FF', 2))
    const filled = i < done ? full : i === done && current ? Math.round(Math.min(1, Math.max(0, current.ratio)) * full) : 0
    if (filled > 0)
      elements.push(rect(name(prefix, `seg${i}`), left, y, filled, height, i < done ? doneFill : current!.fill, 1))
  }
  return elements
}
