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
  /** Name of a timer whose slide has no `busy.activity`. */
  timer: string
}

export type Locale = 'en' | 'fr'

export interface BusybarConfig {
  /** Language of the default texts: `en` (default) or `fr`. */
  locale?: Locale
  labels?: Partial<Labels>
  /** Progress bar colours, one chapter after the other. */
  chapterColors?: string[]
  /** `busy.screen` screens, merged with `pause`, `questions` and `welcome`. */
  screens?: Record<string, Partial<ScreenStyle>>
  /** Logos shown by `busy.screen: <name>`. Each returns `DisplayDraw`
      elements for the 72×16 screen; see `pixels` and `rect`. */
  logos?: Record<string, () => Element[]>
}

export interface ResolvedConfig {
  labels: Labels
  chapterColors: string[]
  screens: Record<string, ScreenStyle>
  logos: Record<string, () => Element[]>
}

/** Identity function, for autocompletion in `busybar.config.ts`. */
export function defineConfig(config: BusybarConfig): BusybarConfig {
  return config
}

const LOCALES: Record<Locale, { labels: Labels, screens: Record<'pause' | 'questions' | 'welcome', string> }> = {
  en: {
    labels: { timeUp: 'Time\'s up', timer: 'Timer' },
    screens: { pause: 'Break', questions: 'Questions?', welcome: 'Welcome!' },
  },
  fr: {
    labels: { timeUp: 'Temps écoulé', timer: 'Chrono' },
    screens: { pause: 'Pause', questions: 'Questions ?', welcome: 'Bienvenue !' },
  },
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
    pause: { title: locale.screens.pause, color: '#FFB454', icon: 'dt_coffee' },
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
  }
}
