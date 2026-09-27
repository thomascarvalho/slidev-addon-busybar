/* Addon configuration: an optional `busybar.config.ts` next to `slides.md`.
   Everything has a default. */
import type { Sound } from './sounds.ts'
import type { Element } from './types.ts'
import { parseDuration } from './duration.ts'
import { parseSound } from './sounds.ts'

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
  /** Back display: under the delay, when behind / ahead of the schedule. */
  late: string
  early: string
  /** Back display: caption of the current chapter's band. */
  chapter: string
  /** Back display: caption of the "what comes next" band. */
  next: string
  /** Back display: the end of the day, once the last step is reached. */
  end: string
}

export type Locale = 'en' | 'fr'

/** Played in the browser window that the bar drives. */
export type SlidevAction = 'next' | 'prev' | 'nextSlide' | 'prevSlide' | 'first' | 'last' | 'overview' | 'dark' | `goto:${number}`
/** Played by the dev server. */
export type TimerControl = 'timer:toggle' | 'timer:add' | 'timer:skip' | 'timer:cancel' | 'timer:set'
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

/** When the bar plays a sound. */
export type SoundMoment = 'timeUp' | 'breakOver' | 'breakWarning' | 'phaseEnd' | 'start'

export interface ScheduleConfig {
  /** How long a slide must stay before its step counts as entered: a
      duration (`10s` by default), so that one wheel notch too far changes
      nothing. */
  grace?: string
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
  /** The sound of each moment: a stock sound name (`'volume_change'`), a
      WAV file of the deck (`'./sounds/gong.wav'`) or `false`. */
  sounds?: Partial<Record<SoundMoment, string | false>>
  /** The day's schedule: the grace before a step counts as entered. */
  schedule?: ScheduleConfig
}

export interface ResolvedConfig {
  labels: Labels
  chapterColors: string[]
  screens: Record<string, ScreenStyle>
  logos: Record<string, () => Element[]>
  /** `null` when turned off. */
  controls: Controls | null
  sounds: Record<SoundMoment, Sound>
  schedule: { graceMs: number }
}

/** Identity function, for autocompletion in `busybar.config.ts`. */
export function defineConfig(config: BusybarConfig): BusybarConfig {
  return config
}

const LOCALES: Record<Locale, { labels: Labels, screens: Record<'break' | 'questions' | 'welcome', string> }> = {
  en: {
    labels: { timeUp: 'Time\'s up', breakOver: 'Break\'s over!', timer: 'Timer', phase: 'Phase', upNext: 'Next', late: 'late', early: 'early', chapter: 'Chapter', next: 'Next', end: 'End' },
    screens: { break: 'Break', questions: 'Questions?', welcome: 'Welcome!' },
  },
  fr: {
    labels: { timeUp: 'Temps écoulé', breakOver: 'On reprend !', timer: 'Chrono', phase: 'Phase', upNext: 'Suivant', late: 'retard', early: 'avance', chapter: 'Chapitre', next: 'Suite', end: 'Fin' },
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
  okHold: 'timer:set',
  switch: true,
}

export const DEFAULT_SOUNDS: Record<SoundMoment, Sound> = {
  timeUp: { stock: 'calendar_reminder_ends' },
  breakOver: { stock: 'calendar_reminder_ends' },
  breakWarning: { stock: 'volume_change' },
  phaseEnd: { stock: 'calendar_reminder_ends' },
  start: null,
}

function resolveSounds(config: BusybarConfig['sounds']): Record<SoundMoment, Sound> {
  const sounds = { ...DEFAULT_SOUNDS }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!(key in DEFAULT_SOUNDS))
      throw new Error(`[busybar] sounds.${key}: unknown moment (timeUp, breakOver, breakWarning, phaseEnd, start)`)
    const sound = parseSound(value)
    if (sound === undefined)
      throw new Error(`[busybar] sounds.${key}: "${value}" is not a stock sound name, a .wav file or false`)
    sounds[key as SoundMoment] = sound
  }
  return sounds
}

export const DEFAULT_GRACE_MS = 10_000

function resolveSchedule(config: BusybarConfig['schedule']): ResolvedConfig['schedule'] {
  if (config?.grace === undefined)
    return { graceMs: DEFAULT_GRACE_MS }
  const graceMs = parseDuration(config.grace)
  if (graceMs === null)
    throw new Error(`[busybar] schedule.grace: "${config.grace}" is not a duration (10s, 1m)`)
  return { graceMs }
}

const ACTIONS = new Set(['next', 'prev', 'nextSlide', 'prevSlide', 'first', 'last', 'overview', 'dark', 'timer:toggle', 'timer:add', 'timer:skip', 'timer:cancel', 'timer:set'])

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
    sounds: resolveSounds(config.sounds),
    schedule: resolveSchedule(config.schedule),
  }
}

/* The `.env.local` settings, read once into a typed object (never exposed to
   the browser, since they lack the `VITE_` prefix):
     BUSYBAR_ADDR      address of the bar (default 10.0.4.20, over USB)
     BUSYBAR_PASSWORD  HTTP access code of the bar, needed over Wi-Fi
     BUSYBAR_ENABLED   `false` turns the addon off
     BUSYBAR_DEBUG     `true` logs every call to the bar */

export interface Settings {
  addr: string
  password: string | undefined
  enabled: boolean
  debug: boolean
  /** Variables that no longer do anything, one line each. */
  warnings: string[]
}

export const DEFAULT_ADDR = '10.0.4.20'

const YES = /^(?:true|1|yes|on)$/i
const NO = /^(?:false|0|no|off)$/i

/* Sounds moved to busybar.config.ts in 0.3.0: say where. */
const RETIRED: Record<string, string> = {
  BUSYBAR_SOUND: 'BUSYBAR_SOUND is no longer used: set sounds.timeUp, sounds.breakOver and sounds.phaseEnd in busybar.config.ts.',
  BUSYBAR_WARN_SOUND: 'BUSYBAR_WARN_SOUND is no longer used: set sounds.breakWarning in busybar.config.ts.',
}

export function readSettings(env: Record<string, string | undefined>): Settings {
  return {
    addr: env.BUSYBAR_ADDR || DEFAULT_ADDR,
    password: env.BUSYBAR_PASSWORD || undefined,
    enabled: !NO.test(env.BUSYBAR_ENABLED ?? ''),
    debug: YES.test(env.BUSYBAR_DEBUG ?? ''),
    warnings: Object.keys(RETIRED).filter(name => env[name] !== undefined).map(name => RETIRED[name]),
  }
}


export interface Log {
  info: (message: string) => void
  warn: (message: string) => void
  /** Every call to the bar, with `BUSYBAR_DEBUG=true`. */
  debug?: (message: string) => void
}

const PREFIX = '[busybar]'

export function createLog(debug: boolean): Log {
  return {
    info: message => console.log(`${PREFIX} ${message}`),
    warn: message => console.warn(`${PREFIX} ${message}`),
    debug: debug ? message => console.log(`${PREFIX} ${message}`) : undefined,
  }
}
