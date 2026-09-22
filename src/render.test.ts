import type { ResolvedConfig } from './config.ts'
import type { RenderState } from './render.ts'
import type { Timer } from './timer.ts'
import type { SlideInfo } from './types.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig } from './config.ts'
import { rect } from './draw.ts'
import { render as renderScene } from './render.ts'

const MIN = 60_000

function slide(extra: Partial<SlideInfo>): SlideInfo {
  return { no: 1, title: null, chapter: null, chapterNo: null, progress: null, activity: null, timer: null, screen: null, until: null, text: null, sound: null, ...extra }
}

function running(leftMs: number, now = 0): Timer {
  return { label: 'Workshop 1', style: null, phases: [{ label: null, ms: 15 * MIN }], index: 0, totalMs: 15 * MIN, endsAt: now + leftMs, leftMs: 0, rang: false, warned: false }
}

/** `setting: null` by default: most tests here are unrelated to it. */
function render(state: Omit<RenderState, 'setting'> & Partial<Pick<RenderState, 'setting'>>, now: number, config?: ResolvedConfig) {
  return renderScene({ setting: null, ...state }, now, config)
}

const byId = (elements: { id: string }[], id: string) => elements.find(e => e.id === id) as Record<string, unknown> | undefined
const chapter = (extra: Partial<SlideInfo>) => render({ slide: slide(extra), timer: null }, 0).elements
const screen = (extra: Partial<SlideInfo>) => render({ slide: slide(extra), timer: null }, 0).elements

test('outside any chapter: the slide title, or nothing', () => {
  assert.deepEqual(render({ slide: null, timer: null }, 0).elements, [])
  assert.deepEqual(chapter({}), [])
  const part = chapter({ title: 'Part 1' })
  assert.equal(byId(part, 'title')!.text, 'Part 1')
  assert.equal(byId(part, 'fill'), undefined)
})

test('a short title is centred, a long one scrolls with its accents', () => {
  const short = byId(chapter({ chapter: 'Hooks' }), 'title')!
  assert.equal(short.align, 'top_mid')
  assert.equal(short.scroll_rate, undefined)
  assert.equal(short.font, 'global')

  const long = byId(chapter({ chapter: 'Référencer du code' }), 'title')!
  assert.equal(long.text, 'Référencer du code')
  assert.equal(long.width, 72)
  assert.ok(Number(long.scroll_rate) > 0)
})

test('progress fills the last row, in the chapter\'s colour', () => {
  const first = chapter({ chapter: 'Hooks', chapterNo: 1, progress: { index: 1, count: 4 } })
  assert.equal(byId(first, 'fill')!.width, 18)
  assert.equal(byId(first, 'fill')!.y, 15)
  assert.equal(byId(first, 'track')!.z_index, 0)
  assert.equal(byId(first, 'fill')!.z_index, 1)

  const config = resolveConfig({ chapterColors: ['#111111', '#222222'] })
  const fill = (chapterNo: number) => byId(render({ slide: slide({ chapter: 'X', chapterNo, progress: { index: 1, count: 1 } }), timer: null }, 0, config).elements, 'fill')!.fill_colors
  assert.deepEqual(fill(1), ['#111111FF'])
  assert.deepEqual(fill(2), ['#222222FF'])
  assert.deepEqual(fill(3), fill(1), 'the palette loops')
})

test('an activity to start shows its name and length, without counting', () => {
  const scene = render({ slide: slide({ chapter: 'Hooks', activity: 'Workshop 1', timer: ['15m'] }), timer: null }, 0)
  assert.equal(byId(scene.elements, 'label')!.text, 'Workshop 1')
  assert.equal(byId(scene.elements, 'value')!.text, '15:00')
  assert.equal(byId(scene.elements, 'fill'), undefined)
  assert.equal(scene.nextAt, null)
})

test('the timer goes green, orange under 20 %, red under a minute', () => {
  const color = (leftMs: number) => byId(render({ slide: null, timer: running(leftMs) }, 0).elements, 'value')!.color
  assert.equal(color(10 * MIN), '#3CD070FF')
  assert.equal(color(3 * MIN), '#FFA000FF')
  assert.equal(color(59_000), '#FF3030FF')
})

test('a running timer wins over the slide and redraws at the next second', () => {
  const scene = render({ slide: slide({ chapter: 'Effects' }), timer: running(754_400, 1000) }, 1000)
  assert.equal(byId(scene.elements, 'value')!.text, '12:35')
  assert.equal(byId(scene.elements, 'title'), undefined)
  assert.equal(scene.nextAt, 1000 + 400 + 5)
})

test('hourglass when there is room, and a gradient that keeps the end of the spectrum', () => {
  const short = render({ slide: null, timer: { ...running(3 * MIN), label: 'Quiz' } }, 0).elements
  assert.match(String(byId(short, 'icon')!.stock_path), /hourglass/)
  assert.equal(byId(short, 'fill')!.fill, 'gradient_h')
  assert.deepEqual(byId(short, 'fill')!.fill_colors, ['#FF3030FF', '#FFA000FF'], '20 % left: red to orange')

  const long = render({ slide: null, timer: running(3 * MIN) }, 0).elements
  assert.equal(byId(long, 'icon'), undefined, 'no room next to "Workshop 1"')
})

test('the label does not move when the countdown gets narrower', () => {
  const t: Timer = { ...running(0), totalMs: 10 * MIN }
  const label = (leftMs: number) => byId(render({ slide: null, timer: { ...t, endsAt: leftMs } }, 0).elements, 'label')
  assert.deepEqual(label(10 * MIN), label(9 * MIN + 59_000))
})

test('paused: time frozen and greyed', () => {
  const paused: Timer = { ...running(0), endsAt: null, leftMs: 754_000 }
  const scene = render({ slide: null, timer: paused }, 999_999)
  assert.equal(byId(scene.elements, 'value')!.text, '12:34')
  assert.equal(byId(scene.elements, 'value')!.color, '#8A8A8AFF')
  assert.equal(scene.nextAt, null)
})

test('time\'s up: localised message, blinking red, red LED', () => {
  const at = (now: number) => render({ slide: null, timer: running(0) }, now, resolveConfig({ locale: 'fr' }))
  const on = at(0)
  const off = at(500)
  assert.equal(byId(on.elements, 'title')!.text, 'Temps écoulé')
  assert.notEqual(byId(on.elements, 'title')!.color, byId(off.elements, 'title')!.color)
  assert.equal(on.nextAt, 500)
  assert.equal(on.led, '#FF3030FF')
})

test('special screens: icon, colour, free text and resume time', () => {
  const brk = screen({ screen: 'break', until: '10:45' })
  assert.match(String(byId(brk, 'icon')!.stock_path), /dt_coffee/)
  assert.equal(byId(brk, 'label')!.text, 'Break')
  assert.equal(byId(brk, 'value')!.text, '10:45')
  assert.ok(Number(byId(brk, 'label')!.x) > 16)
  assert.equal(byId(brk, 'fill')!.width, 72)

  assert.equal(byId(screen({ screen: 'welcome', text: 'Vue training' }), 'title')!.text, 'Vue training')
  const unknown = screen({ screen: 'debrief' })
  assert.equal(byId(unknown, 'title')!.text, 'debrief')
  assert.equal(byId(unknown, 'icon'), undefined)
})

test('a timer in progress is drawn over a special screen', () => {
  const questions = slide({ screen: 'questions' })
  const scene = render({ slide: questions, timer: running(5 * MIN) }, 0)
  assert.equal(byId(scene.elements, 'value')!.text, '5:00')
  assert.equal(byId(scene.elements, 'title'), undefined)
  assert.equal(scene.nextAt, 0 + 1000 + 5, 'behaves as for any running timer')

  const paused: Timer = { ...running(0), endsAt: null, leftMs: 754_000 }
  const grey = render({ slide: questions, timer: paused }, 0)
  assert.equal(byId(grey.elements, 'value')!.text, '12:34')
  assert.equal(byId(grey.elements, 'value')!.color, '#8A8A8AFF')
})

test('a finished timer is drawn over a special screen too', () => {
  const questions = slide({ screen: 'questions' })
  const scene = render({ slide: questions, timer: running(0) }, 0)
  assert.equal(byId(scene.elements, 'title')!.text, 'Time\'s up')
  assert.equal(scene.led, '#FF3030FF')
})

const brk = (extra: Partial<Timer> = {}): Timer => ({ ...running(10 * MIN), label: 'Break', style: 'break', ...extra })

test('a break to start: icon, name, length in white, empty row', () => {
  const scene = render({ slide: slide({ screen: 'break', timer: ['15m'] }), timer: null }, 0)
  assert.match(String(byId(scene.elements, 'icon')!.stock_path), /dt_coffee/)
  assert.equal(byId(scene.elements, 'label')!.text, 'Break')
  assert.equal(byId(scene.elements, 'value')!.text, '15:00')
  assert.equal(byId(scene.elements, 'value')!.color, '#FFFFFFFF')
  assert.equal(byId(scene.elements, 'fill'), undefined)
})

test('a running break is shown over its own screen, in its colours', () => {
  const scene = render({ slide: slide({ screen: 'break', timer: ['15m'] }), timer: brk() }, 0)
  assert.match(String(byId(scene.elements, 'icon')!.stock_path), /dt_coffee/)
  assert.equal(byId(scene.elements, 'value')!.text, '10:00')
  assert.equal(byId(scene.elements, 'value')!.color, '#FFFFFFFF')
  assert.equal(byId(scene.elements, 'label')!.color, '#FFB454FF')
  assert.deepEqual(byId(scene.elements, 'fill')!.fill_colors, ['#FFB454FF'])
  const last = render({ slide: null, timer: brk({ endsAt: 59_000 }) }, 0)
  assert.equal(byId(last.elements, 'value')!.color, '#FFA000FF', 'orange in the last minute')
})

test('a paused break: grey, with its icon', () => {
  const scene = render({ slide: null, timer: brk({ endsAt: null, leftMs: 754_000 }) }, 0)
  assert.match(String(byId(scene.elements, 'icon')!.stock_path), /dt_coffee/)
  assert.equal(byId(scene.elements, 'icon')!.opacity, 35)
  assert.equal(byId(scene.elements, 'value')!.text, '12:34')
  assert.equal(byId(scene.elements, 'value')!.color, '#8A8A8AFF')
  assert.equal(byId(scene.elements, 'label')!.color, '#8A8A8AFF')
  assert.equal(scene.nextAt, null)
})

test('a running break stays in front of another screen', () => {
  const scene = render({ slide: slide({ screen: 'questions' }), timer: brk() }, 0)
  assert.match(String(byId(scene.elements, 'icon')!.stock_path), /dt_coffee/)
  assert.equal(byId(scene.elements, 'value')!.text, '10:00')
})

test('a break slide with a running workshop still shows the workshop', () => {
  const scene = render({ slide: slide({ screen: 'break', timer: ['15m'] }), timer: running(5 * MIN) }, 0)
  assert.equal(byId(scene.elements, 'label')!.text, 'Workshop 1')
  assert.equal(byId(scene.elements, 'value')!.text, '5:00')
})

test('the end of a break calls people back, in its colour', () => {
  const on = render({ slide: null, timer: brk({ endsAt: 0 }) }, 0, resolveConfig({ locale: 'fr' }))
  assert.equal(byId(on.elements, 'title')!.text, 'On reprend !')
  assert.equal(byId(on.elements, 'title')!.color, '#FFB454FF')
  assert.equal(on.led, '#FFB454FF')
})

test('logos from the configuration are drawn as returned', () => {
  const config = resolveConfig({ logos: { acme: () => [rect('logo', 0, 0, 72, 16, '#F65E5E')] } })
  const elements = render({ slide: slide({ screen: 'acme' }), timer: null }, 0, config).elements
  assert.deepEqual(elements, [rect('logo', 0, 0, 72, 16, '#F65E5E')])
})

test('a logo screen with a running timer renders the timer instead', () => {
  const config = resolveConfig({ logos: { acme: () => [rect('logo', 0, 0, 72, 16, '#F65E5E')] } })
  const scene = render({ slide: slide({ screen: 'acme' }), timer: running(5 * MIN) }, 0, config)
  assert.equal(byId(scene.elements, 'label')!.text, 'Workshop 1')
  assert.equal(byId(scene.elements, 'value')!.text, '5:00')
})

const PHASES = [{ label: 'Reading', ms: 5 * MIN }, { label: 'Coding', ms: 10 * MIN }, { label: null, ms: 5 * MIN }]
const lab = (index: number, endsAt: number | null, extra: Partial<Timer> = {}): Timer =>
  ({ ...running(0), label: 'Lab', phases: PHASES, index, totalMs: PHASES[index].ms, endsAt, ...extra })

test('a running phase shows its name and one segment per phase', () => {
  const scene = render({ slide: null, timer: lab(1, 5 * MIN) }, 0)
  assert.equal(byId(scene.elements, 'label')!.text, 'Coding')
  assert.equal(byId(scene.elements, 'seg0')!.width, 23, 'done: full')
  assert.equal(byId(scene.elements, 'seg1')!.x, 24)
  assert.equal(byId(scene.elements, 'seg1')!.width, 12, 'half of the current phase')
  assert.equal(byId(scene.elements, 'seg2'), undefined, 'to come: the track')
  assert.equal(byId(scene.elements, 'gap1')!.x, 23)
  assert.equal(byId(scene.elements, 'fill'), undefined)
})

test('between two phases: calm screen with what comes next', () => {
  const at = (now: number) => render({ slide: null, timer: lab(0, 0) }, now)
  const calm = at(2000)
  assert.equal(byId(calm.elements, 'label')!.text, 'Next Coding')
  assert.equal(byId(calm.elements, 'value')!.text, '10:00')
  assert.equal(byId(calm.elements, 'value')!.color, '#FFFFFFFF')
  assert.equal(byId(calm.elements, 'seg0')!.width, 23)
  assert.equal(byId(calm.elements, 'seg1'), undefined)
  assert.equal(calm.led, undefined)
  assert.equal(calm.nextAt, 30_000, 'next change: the LED')
  assert.notEqual(byId(at(0).elements, 'label')!.color, byId(at(500).elements, 'label')!.color, 'one short blink')
  assert.equal(at(30_000).led, '#FFA000FF')
  assert.equal(at(30_000).nextAt, null)
})

test('an unnamed phase is numbered', () => {
  const scene = render({ slide: null, timer: lab(2, MIN) }, 0)
  assert.equal(byId(scene.elements, 'label')!.text, 'Phase 3')
})

test('a workshop to start: its name, its first phase, empty segments', () => {
  const scene = render({ slide: slide({ activity: 'Lab', timer: ['5m Reading', '10m Coding', '5m'] }), timer: null }, 0)
  assert.equal(byId(scene.elements, 'label')!.text, 'Lab')
  assert.equal(byId(scene.elements, 'value')!.text, '5:00')
  assert.ok(byId(scene.elements, 'gap1'))
  assert.equal(byId(scene.elements, 'seg0'), undefined)
})

test('a waiting timer also stays in front of a screen', () => {
  const scene = render({ slide: slide({ screen: 'questions' }), timer: lab(0, 0) }, 2000)
  assert.equal(byId(scene.elements, 'label')!.text, 'Next Coding')
  assert.equal(byId(scene.elements, 'title'), undefined)
  assert.equal(scene.nextAt, 30_000)
})

test('the setting is drawn in front of everything, digits blinking until it expires', () => {
  const setting = { ms: 7 * MIN, until: 15_000 }
  const on = render({ slide: slide({ screen: 'questions' }), timer: running(5 * MIN), setting }, 0)
  assert.equal(byId(on.elements, 'label')!.text, 'Timer')
  assert.equal(byId(on.elements, 'value')!.text, '7:00')
  const off = render({ slide: null, timer: null, setting }, 500)
  assert.notEqual(byId(on.elements, 'value')!.color, byId(off.elements, 'value')!.color)
  assert.equal(on.nextAt, 500)
  assert.equal(render({ slide: null, timer: null, setting }, 14_800).nextAt, 15_000, 'capped at the expiry')
})
