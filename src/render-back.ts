/* The back display, the trainer's side: 160×80 in greys. Three bands: the
   clock and the delay; the current step and its time left, or the timer in
   progress; what comes next. Pure like `render.ts`: every element carries
   `display: 'back'` and an id prefixed `back:`, so that the relay can send
   both displays in one draw and diff them together.

   The firmware draws its status column (Bluetooth, battery…) over the
   rightmost 12 pixels: nothing is drawn past x = 148. Its fonts top out at
   12 px, so the clock and countdowns are home-made digits (`digits()`). */
import type { DeviceFont } from '@busy-app/busy-lib'
import type { Labels, ResolvedConfig } from './config.ts'
import type { RenderState, Scene } from './render.ts'
import type { Status } from './schedule.ts'
import type { Timer } from './timer.ts'
import type { Element, Schedule, Step } from './types.ts'
import { digits, digitsWidth, textWidth } from './draw.ts'
import { formatClock, formatTime } from './duration.ts'
import { fit, line as lined, segments as segmented } from './elements.ts'
import { clockMs, minutesOfDay, status } from './schedule.ts'
import { phaseName, remaining, status as timerStatus } from './timer.ts'

export const BACK = { width: 160, height: 80 } as const

/* Greys only: the back display has no colour. */
const WHITE = '#FFFFFFFF'
const GREY = '#8A8A8AFF'
const DARK = '#404040FF'
const RULE = '#303030FF'

const MINUTE = 60_000
const MARGIN = 4
/** The firmware's status column starts here. */
const RIGHT = 148
const INNER = RIGHT - MARGIN
/* Bands: rows 0–25, 27–52 and 54–79, with a rule between. */
const RULE_1 = 26
const RULE_2 = 53
const GAP = 6
const BLINK_MS = 500
/* The font with accents (the step names), as on the front. */
const TEXT: DeviceFont = 'global'
/* Home-made digits: the clock 20 px high, the delay and countdowns 15 px. */
const CLOCK_SCALE = 4
const DIGIT_SCALE = 3

function back<T extends Element>(element: T): T {
  return { ...element, display: 'back' }
}

/** Text anchored at (x, y) if it fits in `width`, scrolling within its
    room otherwise; `x` is the right edge when right-aligned. */
function text(id: string, value: string, font: DeviceFont, color: string, x: number, y: number, width: number, align: 'top_left' | 'top_right'): Element {
  const right = align === 'top_right'
  return back(fit(id, value, font, color, { x: right ? x - width : x, y, width }, right ? 'right' : 'left'))
}

/** Big digits, their top-left (or top-right) at (x, y). */
function big(id: string, value: string, color: string, x: number, y: number, scale: number, align: 'left' | 'right'): Element {
  return back(digits(id, value, color, x, y, scale, align))
}

function rect(id: string, x: number, y: number, width: number, height: number, color: string, z_index = 0): Element {
  return back({ id, type: 'rectangle', x, y, width, height, fill: 'solid', fill_colors: [color], border_width: 0, z_index })
}

/* A band's 2-px progress line, two dark pixels between two segments. */
const band = (y: number) => ({ x: MARGIN, y, width: INNER, height: 2, track: DARK, gap: 2 })

/** A line across the band, filled to `ratio`. */
function line(prefix: string, y: number, ratio: number, color: string): Element[] {
  return lined(prefix, band(y), ratio, color).map(back)
}

/** One segment per phase: done ones full, the current one to `ratio`, the
    rest as the track. */
function segments(prefix: string, y: number, count: number, done: number, current: { ratio: number, color: string } | null): Element[] {
  return segmented(prefix, band(y), count, done, current && { ratio: current.ratio, fill: current.color }, WHITE).map(back)
}

/** A chapter's title, or a screen's `text`, its configured title, or its name. */
function stepLabel(step: Step, config: ResolvedConfig): string {
  if (step.kind === 'chapter')
    return step.label ?? ''
  return step.label ?? config.screens[step.kind]?.title ?? step.kind
}

/** The clock, and the delay when a step is entered. */
function topBand(st: Status, now: number, labels: Labels): Element[] {
  const elements = [big('back:clock', formatTime(minutesOfDay(now)), WHITE, MARGIN, 3, CLOCK_SCALE, 'left')]
  if (st.delay === null)
    return elements
  const value = st.delay > 0 ? `+${st.delay}` : String(st.delay)
  elements.push(big('back:delay', value, st.delay ? WHITE : GREY, RIGHT, 3, DIGIT_SCALE, 'right'))
  if (st.delay)
    elements.push(text('back:delay-label', st.delay > 0 ? labels.late : labels.early, 'tiny', GREY, RIGHT, 20, 60, 'top_right'))
  return elements
}

/** The current step: caption (chapters only), name, time left, progress. */
function stepBand(st: Status, now: number, config: ResolvedConfig): Element[] {
  if (!st.current)
    return []
  const { step } = st.current
  const elements: Element[] = []
  if (step.kind === 'chapter')
    elements.push(text('back:step-title', config.labels.chapter.toUpperCase(), 'tiny', GREY, MARGIN, 29, 100, 'top_left'))
  const left = st.remaining
  const value = left === null ? '' : `${left < 0 ? '-' : ''}${Math.ceil(Math.abs(left) / MINUTE)} min`
  const valueWidth = value ? textWidth(value, 'bold') + GAP : 0
  elements.push(text('back:step', stepLabel(step, config), TEXT, WHITE, MARGIN, 37, INNER - valueWidth, 'top_left'))
  if (value)
    elements.push(text('back:step-left', value, 'bold', left! >= 0 ? WHITE : GREY, RIGHT, 37, 60, 'top_right'))
  if (step.durationMs > 0 && st.enteredAt !== null)
    elements.push(...line('back:step', 49, (now - st.enteredAt) / step.durationMs, WHITE))
  return elements
}

/** The timer in progress, in greys: the same states as the front. */
function timerBand(timer: Timer, now: number, config: ResolvedConfig): Element[] {
  const left = remaining(timer, now)
  const many = timer.phases.length > 1
  const widest = formatClock(timer.totalMs)
  const labelWidth = (value: string) => INNER - digitsWidth(value, DIGIT_SCALE) - GAP
  const row = (label: string, value: string, color: string, reserved = widest) => [
    text('back:timer', label, TEXT, color, MARGIN, 33, labelWidth(reserved), 'top_left'),
    big('back:timer-value', value, color, RIGHT, 30, DIGIT_SCALE, 'right'),
  ]
  const progress = (ratio: number, color: string) => many
    ? segments('back:timer', 49, timer.phases.length, timer.index, { ratio, color })
    : line('back:timer', 49, ratio, color)
  const label = many ? phaseName(timer, timer.index, config.labels) : timer.label
  switch (timerStatus(timer, now)) {
    case 'running':
      return [...row(label, formatClock(left), WHITE), ...progress(left / timer.totalMs, WHITE)]
    case 'paused':
      return [...row(label, formatClock(left), GREY), ...progress(left / timer.totalMs, GREY)]
    case 'waiting': {
      const next = timer.index + 1
      const value = formatClock(timer.phases[next].ms)
      return [...row(`${config.labels.upNext} ${phaseName(timer, next, config.labels)}`, value, WHITE, value), ...segments('back:timer', 49, timer.phases.length, next, null)]
    }
    case 'finished': {
      const color = Math.floor(now / BLINK_MS) % 2 === 0 ? WHITE : DARK
      const title = timer.style ? config.labels.breakOver : config.labels.timeUp
      return [text('back:timer', title, TEXT, color, MARGIN, 37, INNER, 'top_left'), ...line('back:timer', 49, 1, color)]
    }
  }
}

/** What comes next: the next step and its planned start, or the end of
    the day. */
function nextBand(st: Status, schedule: Schedule | null, now: number, config: ResolvedConfig): Element[] {
  if (!schedule)
    return []
  let label: string
  let at: number | null
  if (st.next) {
    label = stepLabel(st.next.step, config)
    at = st.next.at
  }
  else if (st.current && schedule.end !== null) {
    label = config.labels.end
    at = clockMs(schedule.end, now)
  }
  else {
    return []
  }
  const time = at === null ? '' : formatTime(minutesOfDay(at))
  const timeWidth = time ? textWidth(time, 'bold') + GAP : 0
  const elements = [
    text('back:next-title', config.labels.next.toUpperCase(), 'tiny', GREY, MARGIN, 56, 100, 'top_left'),
    text('back:next', label, TEXT, WHITE, MARGIN, 64, INNER - timeWidth, 'top_left'),
  ]
  if (time)
    elements.push(text('back:next-time', time, 'bold', WHITE, RIGHT, 64, 60, 'top_right'))
  return elements
}

/** The whole back display. Refreshed at the top of every minute; the
    seconds of a timer and the blinking come from the front's `nextAt`. */
export function renderBack(state: RenderState, now: number, config: ResolvedConfig): Scene {
  const st = status(state.schedule, state.day, now)
  return {
    elements: [
      ...topBand(st, now, config.labels),
      rect('back:rule1', 0, RULE_1, RIGHT, 1, RULE),
      ...(state.timer ? timerBand(state.timer, now, config) : stepBand(st, now, config)),
      rect('back:rule2', 0, RULE_2, RIGHT, 1, RULE),
      ...nextBand(st, state.schedule, now, config),
    ],
    nextAt: now + MINUTE - (now % MINUTE),
  }
}
