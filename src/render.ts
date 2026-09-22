/* Pure renderer: state → `DisplayDraw` elements for the 72×16 screen. No
   network here, everything is testable without the bar.

   Every element has a fixed `id` per slot: the bar replaces an element drawn
   again under the same id, and the relay clears the ones that go away. */
import type { DeviceFont } from '@busy-app/busy-lib'
import type { ResolvedConfig, ScreenStyle } from './config.ts'
import type { Timer } from './timer.ts'
import type { Element, SlideInfo } from './types.ts'
import { resolveConfig } from './config.ts'
import { SCREEN, textWidth } from './draw.ts'
import { formatClock } from './duration.ts'
import { toDeviceText } from './text.ts'
import { armed, phaseName, remaining, status, WARN_MS } from './timer.ts'

export interface Scene {
  elements: Element[]
  /** When the scene changes on its own (countdown, blinking). */
  nextAt: number | null
  /** Blink colour of the status LED, `#RRGGBBAA`. */
  led?: string
}

export interface RenderState {
  slide: SlideInfo | null
  timer: Timer | null
}

const WHITE = '#FFFFFFFF'
const GREY = '#8A8A8AFF'
const GREEN = '#3CD070FF'
const ORANGE = '#FFA000FF'
const RED = '#FF3030FF'
const TRACK = '#2A1C1AFF'

/* Firmware images, in `/ext/apps_assets/shared/images/`. */
const image = (name: string) => `shared/images/${name}.image`
const ICON_SIZE = 16

/* The bar's native scrolling, in pixels per minute. */
const SCROLL = { scroll_rate: 900, scroll_start_delay: 1500, scroll_repeat_delay: 2000 }
const BLINK_MS = 500
/* The status LED reminds a trainer who missed the end of a phase. */
const WAIT_LED_MS = 30_000

/* The only font of the bar with accented letters; its capitals are as tall
   as `bold`'s. Timer digits stay in `large`. */
const FONT: DeviceFont = 'global'
/* Puts capitals on rows 3 to 9, accents above. */
const TEXT_Y = 2
/* The 5×5 timer hourglass, aligned with capitals. */
const HOURGLASS = { width: 5, gap: 2, y: 4 }
/* Minimum gap between a label and its value, so that they do not read as
   one word ("Break10:45"). */
const GAP = 4

/** Text within [x, x + width]: centred if it fits, scrolling otherwise. */
function text(id: string, value: string, color: string, x = 0, width: number = SCREEN.width): Element {
  const content = toDeviceText(value)
  if (textWidth(content, FONT) <= width)
    return { id, type: 'text', text: content, font: FONT, color, x: x + Math.floor(width / 2), y: TEXT_Y, align: 'top_mid' }
  return { id, type: 'text', text: content, font: FONT, color, x, y: TEXT_Y, align: 'top_left', width, ...SCROLL }
}

function icon(name: string, x = 0, y = 0, opacity = 100): Element {
  return { id: 'icon', type: 'image', stock_path: image(name), x, y, opacity }
}

/** A bar on the last row of pixels, filled to `ratio` (0 to 1), solid or as
    a horizontal gradient from `color[0]` to `color[1]`.

    The track's explicit `z_index: 0` matters: without it, firmware 1.2.4
    draws the track over the fill whenever a text element comes first. */
function bar(ratio: number, color: string | [string, string]): Element[] {
  const width = Math.round(Math.min(1, Math.max(0, ratio)) * SCREEN.width)
  const row = { type: 'rectangle', x: 0, y: SCREEN.height - 1, height: 1, border_width: 0 } as const
  const elements: Element[] = [{ ...row, id: 'track', width: SCREEN.width, fill: 'solid', fill_colors: [TRACK], z_index: 0 }]
  if (width > 0) {
    const fill = typeof color === 'string'
      ? { fill: 'solid' as const, fill_colors: [color] }
      : { fill: 'gradient_h' as const, fill_colors: [...color] }
    elements.push({ ...row, ...fill, id: 'fill', width, z_index: 1 })
  }
  return elements
}

/** One segment per phase on the last row, separated by a dark pixel:
    `done` phases full, the current one (if any) filled to `ratio` in
    `color`, the others left as the track. */
function segments(count: number, done: number, current: { ratio: number, color: string | [string, string] } | null): Element[] {
  const row = { type: 'rectangle', y: SCREEN.height - 1, height: 1, border_width: 0 } as const
  const width = Math.floor((SCREEN.width - (count - 1)) / count)
  const elements: Element[] = [{ ...row, id: 'track', x: 0, width: SCREEN.width, fill: 'solid', fill_colors: [TRACK], z_index: 0 }]
  for (let i = 0; i < count; i++) {
    const x = i * (width + 1)
    const full = i === count - 1 ? SCREEN.width - x : width
    if (i > 0)
      elements.push({ ...row, id: `gap${i}`, x: x - 1, width: 1, fill: 'solid', fill_colors: ['#000000FF'], z_index: 2 })
    const filled = i < done ? full : i === done && current ? Math.round(Math.min(1, Math.max(0, current.ratio)) * full) : 0
    if (filled > 0) {
      const color = i < done ? GREEN : current!.color
      const fill = typeof color === 'string'
        ? { fill: 'solid' as const, fill_colors: [color] }
        : { fill: 'gradient_h' as const, fill_colors: [...color] }
      elements.push({ ...row, ...fill, id: `seg${i}`, x, width: filled, z_index: 1 })
    }
  }
  return elements
}

/** Room left for a label next to a value, `left` pixels reserved. */
function labelWidth(value: string, font: DeviceFont, left: number): number {
  return SCREEN.width - textWidth(value, font) - GAP - left
}

/** A label on the left, a value on the right (large by default). The value's
    room is reserved for `widest`, so that the label does not move when the
    countdown goes from 10:00 to 9:59. `left` pixels stay free on the left. */
function labelled(label: string, value: string, color: string, labelColor = color, widest = value, left = 0, font: DeviceFont = 'large'): Element[] {
  const reserved = textWidth(widest, font) > textWidth(value, font) ? widest : value
  return [
    text('label', label, labelColor, left, labelWidth(reserved, font, left)),
    { id: 'value', type: 'text', text: value, font, color, x: SCREEN.width, y: font === 'large' ? 0 : TEXT_Y, align: 'top_right' },
  ]
}

function countdownColor(timer: Timer, left: number): string {
  if (left < 60_000)
    return RED
  return left <= timer.totalMs * 0.2 ? ORANGE : GREEN
}

function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const parts = [0, 1, 2].map(i => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t))
  return `#${parts.map(p => p.toString(16).padStart(2, '0')).join('').toUpperCase()}FF`
}

/** Gradient colour at `ratio`: red at 0, orange at 20 %, green at 100 %. */
function spectrum(ratio: number): string {
  const r = Math.min(1, Math.max(0, ratio))
  return r <= 0.2 ? mix(RED, ORANGE, r / 0.2) : mix(ORANGE, GREEN, (r - 0.2) / 0.8)
}

/** Label on the left, time on the right: the same layout for an activity to
    start, a running timer and a paused one. The hourglass precedes the label
    only if there is room: a scrolling label reads worse than no hourglass. */
function timerLayout(label: string, value: string, color: string, labelColor: string, widest: string, running: boolean, style?: ScreenStyle): Element[] {
  /* The screen's icon names the break itself, so it is always drawn; the
     hourglass is mere decoration, dropped when there is no room for it. */
  if (style?.icon)
    return [icon(style.icon, 0, 0, running ? 100 : 35), ...labelled(label, value, color, labelColor, widest, ICON_SIZE + 1)]
  const left = HOURGLASS.width + HOURGLASS.gap
  if (textWidth(toDeviceText(label), FONT) > labelWidth(widest, 'large', left))
    return labelled(label, value, color, labelColor, widest)
  return [icon('hourglass_5x5', 0, HOURGLASS.y, running ? 100 : 35), ...labelled(label, value, color, labelColor, widest, left)]
}

/** The style of a screen; an unknown screen is its name, in white. */
function styleOf(screen: string, config: ResolvedConfig): ScreenStyle {
  return config.screens[screen] ?? { title: screen, color: WHITE }
}

function renderTimer(timer: Timer, now: number, config: ResolvedConfig): Scene {
  const left = remaining(timer, now)
  const widest = formatClock(timer.totalMs)
  const style = timer.style ? styleOf(timer.style, config) : undefined
  const many = timer.phases.length > 1
  const label = many ? phaseName(timer, timer.index, config.labels) : timer.label
  switch (status(timer, now)) {
    case 'running': {
      const ratio = left / timer.totalMs
      /* A break stays calm: white digits, orange in the last minute, the
         row drains in its colour. */
      const elements = style
        ? [...timerLayout(label, formatClock(left), left <= WARN_MS ? ORANGE : WHITE, style.color, widest, true, style), ...bar(ratio, style.color)]
        : [
            ...timerLayout(label, formatClock(left), countdownColor(timer, left), WHITE, widest, true),
            /* The fill shows what is left of the red → green spectrum: one
               phase, a bar; several, one segment per phase. */
            ...(many ? segments(timer.phases.length, timer.index, { ratio, color: [RED, spectrum(ratio)] }) : bar(ratio, [RED, spectrum(ratio)])),
          ]
      /* Right after the displayed second changes. */
      return { elements, nextAt: now + (left % 1000 || 1000) + 5 }
    }
    case 'paused':
      return {
        elements: [
          ...timerLayout(label, formatClock(left), GREY, GREY, widest, false, style),
          ...(many ? segments(timer.phases.length, timer.index, { ratio: left / timer.totalMs, color: GREY }) : bar(left / timer.totalMs, GREY)),
        ],
        nextAt: null,
      }
    case 'waiting': {
      /* Calm: what comes next, still; one short blink when the phase ends,
         the LED if nothing starts for a while. */
      const since = now - (timer.endsAt ?? now)
      const next = timer.index + 1
      const value = formatClock(timer.phases[next].ms)
      const blink = since < 2 * BLINK_MS && Math.floor(since / BLINK_MS) % 2 === 0
      return {
        elements: [
          ...timerLayout(`${config.labels.upNext} ${phaseName(timer, next, config.labels)}`, value, WHITE, blink ? GREY : WHITE, value, false),
          ...segments(timer.phases.length, next, null),
        ],
        nextAt: since < 2 * BLINK_MS
          ? now + BLINK_MS - (since % BLINK_MS)
          : since < WAIT_LED_MS ? (timer.endsAt ?? now) + WAIT_LED_MS : null,
        led: since >= WAIT_LED_MS ? ORANGE : undefined,
      }
    }
    case 'finished': {
      const lit = style?.color ?? RED
      const color = Math.floor(now / BLINK_MS) % 2 === 0 ? lit : mix(lit, '#000000FF', 0.75)
      return {
        elements: [text('title', style ? config.labels.breakOver : config.labels.timeUp, color), ...bar(1, color)],
        nextAt: now + BLINK_MS - (now % BLINK_MS),
        led: lit,
      }
    }
  }
}

function renderScreen(slide: SlideInfo, screen: string, config: ResolvedConfig): Scene {
  const logo = config.logos[screen]
  if (logo)
    return { elements: logo(), nextAt: null }

  const style: ScreenStyle = config.screens[screen] ?? { title: screen, color: WHITE }
  const title = slide.text ?? style.title
  /* The firmware icon on the left, 16×16; the text in the room left. */
  const left = style.icon ? ICON_SIZE + 1 : 0
  const elements: Element[] = style.icon ? [icon(style.icon)] : []
  /* `until: "10:45"`: when the session resumes, on the right, in the text
     font so that it fits next to the icon. */
  if (slide.until)
    elements.push(...labelled(title, toDeviceText(slide.until), WHITE, style.color, slide.until, left, FONT))
  else
    elements.push(text('title', title, style.color, left, SCREEN.width - left))
  return { elements: [...elements, ...bar(1, style.color)], nextAt: null }
}

/* By priority: finished timer (it must be seen), break over its own
   screen, special screen, running timer, activity or break to start,
   chapter. */
export function render(state: RenderState, now: number, config: ResolvedConfig = resolveConfig()): Scene {
  const slide = state.slide
  const timer = state.timer
  if (timer && status(timer, now) === 'finished')
    return renderTimer(timer, now, config)
  if (slide?.screen) {
    if (timer?.style === slide.screen)
      return renderTimer(timer, now, config)
    const ready = timer ? null : armed(slide, config)
    if (ready) {
      const style = styleOf(slide.screen, config)
      const value = formatClock(ready.phases[0].ms)
      /* A break ready to start shows its screen as it is, at full opacity,
         unlike the dimmed hourglass of a plain activity to start. */
      return { elements: [...timerLayout(ready.label, value, WHITE, style.color, value, true, style), ...bar(0, style.color)], nextAt: null }
    }
    /* A timer running behind the screen must take over when it ends; a
       waiting or paused one has no such moment, or the relay would render
       again at once (its end already lies in the past). */
    return { ...renderScreen(slide, slide.screen, config), nextAt: timer && status(timer, now) === 'running' ? timer.endsAt : null }
  }
  if (timer)
    return renderTimer(timer, now, config)

  const activity = armed(slide, config)
  if (activity) {
    const value = formatClock(activity.phases[0].ms)
    const row = activity.phases.length > 1 ? segments(activity.phases.length, 0, null) : bar(0, WHITE)
    return { elements: [...timerLayout(activity.label, value, WHITE, WHITE, value, false), ...row], nextAt: null }
  }

  /* Outside any chapter, the slide's (or deck's) title rather than nothing:
     the bar would otherwise fall back to its own default screen. */
  if (!slide?.chapter) {
    return slide?.title
      ? { elements: [text('title', slide.title, WHITE)], nextAt: null }
      : { elements: [], nextAt: null }
  }
  /* Every chapter gets its colour, in palette order. */
  const colors = config.chapterColors
  const color = colors[((slide.chapterNo ?? 1) - 1) % colors.length]
  const elements = [text('title', slide.chapter, WHITE)]
  if (slide.progress)
    elements.push(...bar(slide.progress.index / slide.progress.count, color))
  return { elements, nextAt: null }
}
