/* Addon configuration: an optional `busybar.config.ts` next to `slides.md`.
   Everything has a default. */
import type { Element } from './types.ts'

export interface ScreenStyle {
  /** Text shown on the bar; `busy.text` on the slide overrides it. */
  title: string
  /** `#RRGGBB` or `#RRGGBBAA`. */
  color: string
  /** A firmware image such as `dt_coffee` (see the README). */
  icon?: string
}

export interface Labels {
  /** Shown when a timer runs out. */
  timeUp: string
  /** Shown when a break runs out. */
  breakOver: string
  /** Name of a timer whose slide has no `busy.activity`. */
  timer: string
  /** Name of an unnamed workshop phase, followed by its number. */
  phase: string
  /** Before the name of the next phase of a workshop. */
  upNext: string
}

export type Locale = 'en' | 'fr'

/** Played in the browser window that the bar drives. */
export type SlidevAction = 'next' | 'prev' | 'nextSlide' | 'prevSlide' | 'first' | 'last' | 'overview' | 'dark' | `goto:${number}`
/** Played by the dev server. */
export type TimerControl = 'timer:toggle' | 'timer:add' | 'timer:skip' | 'timer:cancel'
/** What a button of the bar does; `false` for nothing. */
export type ControlAction = SlidevAction | TimerControl | false

export interface Controls {
  /** `clicks`: next or previous click (Slidev's `next`/`prev`); `slides`:
      skips the clicks. */
  wheel: 'clicks' | 'slides' | false
  /** Start/Stop, pressed then held. */
  start: ControlAction
  startHold: ControlAction
  back: ControlAction
  backHold: ControlAction
  /** The wheel's click. */
  ok: ControlAction
  okHold: ControlAction
  /** Says when the switch leaves APPS, redraws when it comes back. */
  switch: boolean
}

export interface BusybarConfig {
  /** Language of the default texts: `en` (default) or `fr`. */
  locale?: Locale
  labels?: Partial<Labels>
  /** Progress bar colours, one chapter after the other. */
  chapterColors?: string[]
  /** `busy.screen` screens, merged with `break`, `questions` and `welcome`. */
  screens?: Record<string, Partial<ScreenStyle>>
  /** Logos shown by `busy.screen: <name>`. Each returns `DisplayDraw`
      elements for the 72×16 screen; see `pixels` and `rect`. */
  logos?: Record<string, () => Element[]>
  /** What the bar's wheel, buttons and switch do, merged with the defaults;
      `false` stops listening to the bar. */
  controls?: Partial<Controls> | false
}

export interface ResolvedConfig {
  labels: Labels
  chapterColors: string[]
  screens: Record<string, ScreenStyle>
  logos: Record<string, () => Element[]>
  /** `null` when turned off. */
  controls: Controls | null
}

/** Identity function, for autocompletion in `busybar.config.ts`. */
export function defineConfig(config: BusybarConfig): BusybarConfig {
  return config
}

const LOCALES: Record<Locale, { labels: Labels, screens: Record<'break' | 'questions' | 'welcome', string> }> = {
  en: {
    labels: { timeUp: 'Time\'s up', breakOver: 'Break\'s over!', timer: 'Timer', phase: 'Phase', upNext: 'Next' },
    screens: { break: 'Break', questions: 'Questions?', welcome: 'Welcome!' },
  },
  fr: {
    labels: { timeUp: 'Temps écoulé', breakOver: 'On reprend !', timer: 'Chrono', phase: 'Phase', upNext: 'Suivant' },
    screens: { break: 'Pause', questions: 'Questions ?', welcome: 'Bienvenue !' },
  },
}

export const DEFAULT_CONTROLS: Controls = {
  wheel: 'clicks',
  start: 'timer:toggle',
  startHold: 'timer:add',
  back: false,
  backHold: 'timer:cancel',
  ok: false,
  okHold: false,
  switch: true,
}

const ACTIONS = new Set(['next', 'prev', 'nextSlide', 'prevSlide', 'first', 'last', 'overview', 'dark', 'timer:toggle', 'timer:add', 'timer:skip', 'timer:cancel'])

export function isControlAction(value: unknown): value is ControlAction {
  return value === false || (typeof value === 'string' && (ACTIONS.has(value) || /^goto:[1-9]\d*$/.test(value)))
}

function resolveControls(config: BusybarConfig['controls']): Controls | null {
  if (config === false)
    return null
  const controls = { ...DEFAULT_CONTROLS, ...config }
  if (controls.wheel !== 'clicks' && controls.wheel !== 'slides' && controls.wheel !== false)
    throw new Error(`[busybar] controls.wheel: "${controls.wheel}" (expected 'clicks', 'slides' or false)`)
  for (const key of ['start', 'startHold', 'back', 'backHold', 'ok', 'okHold'] as const) {
    if (!isControlAction(controls[key]))
      throw new Error(`[busybar] controls.${key}: unknown action "${controls[key]}" (see the README)`)
  }
  return controls
}

/* Saturated colours: dark or greyish tones read poorly on LEDs. */
const CHAPTER_COLORS = ['#FF8FB1', '#6CB4FF', '#FFB454', '#7DDB8B', '#C99BFF', '#FF7A5C']

/** `#RGB` or `#RRGGBB` → `#RRGGBBAA`, the bar's colour format. */
export function toBarColor(color: string): string {
  const hex = color.trim().toUpperCase()
  if (/^#[0-9A-F]{8}$/.test(hex))
    return hex
  if (/^#[0-9A-F]{6}$/.test(hex))
    return `${hex}FF`
  if (/^#[0-9A-F]{3}$/.test(hex))
    return `#${[...hex.slice(1)].map(c => c + c).join('')}FF`
  throw new Error(`[busybar] invalid colour "${color}" (expected #RRGGBB or #RRGGBBAA)`)
}

export function resolveConfig(config: BusybarConfig = {}): ResolvedConfig {
  const locale = LOCALES[config.locale ?? 'en']
  if (!locale)
    throw new Error(`[busybar] unknown locale "${config.locale}" (en or fr)`)

  const defaults: Record<string, ScreenStyle> = {
    break: { title: locale.screens.break, color: '#FFB454', icon: 'dt_coffee' },
    questions: { title: locale.screens.questions, color: '#6CB4FF', icon: 'dt_dialog' },
    welcome: { title: locale.screens.welcome, color: '#FF8FB1', icon: 'dt_sparkls_1' },
  }
  const screens: Record<string, ScreenStyle> = {}
  for (const name of new Set([...Object.keys(defaults), ...Object.keys(config.screens ?? {})])) {
    const base: Partial<ScreenStyle> = defaults[name] ?? {}
    const merged = { ...base, ...config.screens?.[name] }
    screens[name] = { ...merged, title: merged.title ?? name, color: toBarColor(merged.color ?? '#FFFFFF') }
  }

  return {
    labels: { ...locale.labels, ...config.labels },
    chapterColors: (config.chapterColors?.length ? config.chapterColors : CHAPTER_COLORS).map(toBarColor),
    screens,
    logos: config.logos ?? {},
    controls: resolveControls(config.controls),
  }
}
