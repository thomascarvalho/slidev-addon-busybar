/* Sound values: what the deck asks the bar to play. Pure helpers; the
   store that converts and uploads WAV files is `sound-store.ts`. */
import type { AudioPlayParams } from '@busy-app/busy-lib'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** A stock sound of the bar, a WAV file of the deck, or `null` for silence. */
export type Sound = { stock: string } | { file: string } | null

/** Firmware 1.2.4's sounds, in `/ext/apps_assets/shared/sounds/`. */
export const STOCK_SOUNDS = ['calendar_event_starts', 'calendar_reminder_ends', 'volume_change']

/** The application the addon draws, plays and uploads as. */
export const APPLICATION = 'slidev'

/** `'volume_change'`, `'./sounds/gong.wav'` or `false`; `undefined` when the
    value is none of those. */
export function parseSound(value: unknown): Sound | undefined {
  if (value === false)
    return null
  if (typeof value !== 'string')
    return undefined
  const v = value.trim()
  if (/\.wav$/i.test(v))
    return { file: v }
  if (/^[\w-]+$/.test(v))
    return { stock: v }
  return undefined
}

/* Formats a trainer is likely to have, that `ffmpeg` converts in one step. */
const CONVERTIBLE = /\.(mp3|ogg|m4a|aac|flac|aiff)$/i

/** What to tell the console about an invalid `busy.sound`: the deck's own
    sound plays instead, with a conversion hint for a known audio format. */
export function invalidSoundMessage(value: string): string {
  const hint = CONVERTIBLE.test(value) ? ` Convert it (ffmpeg -i ${value} ${value.replace(/\.[^./]*$/, '')}.wav).` : ''
  return `busy.sound "${value}": not a stock sound name or a .wav file; the deck's sound plays instead.${hint}`
}

/** The absolute path of a deck WAV file; `null` when `path` is not a `.wav`
    or leaves the deck's folder: a slide's sound comes from the browser. */
export function deckFile(root: string, path: string): string | null {
  if (!/\.wav$/i.test(path))
    return null
  const full = resolve(root, path)
  const inside = relative(root, full)
  const outside = inside === '..' || inside.startsWith(`..${sep}`)
  return inside && !outside && !isAbsolute(inside) ? full : null
}

/** What to play for a sound right now. */
export interface SoundPlayer {
  /** `fallback` is played when `sound` is a file that is not ready. */
  resolve: (sound: Sound, fallback: Sound) => AudioPlayParams | null
}

/* Stock sounds must be addressed as `.snd`: a `.wav` path answers OK and
   plays nothing. */
function stock(name: string): AudioPlayParams {
  return { application_name: APPLICATION, stock_path: `shared/${name}.snd` }
}

/** Plays stock sounds only: files fall back. For relays without a store. */
export const stockPlayer: SoundPlayer = {
  resolve(sound, fallback) {
    if (!sound)
      return null
    if ('stock' in sound)
      return stock(sound.stock)
    return fallback && 'stock' in fallback ? stock(fallback.stock) : null
  },
}
