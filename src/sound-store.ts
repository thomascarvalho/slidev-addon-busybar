/* Converts the deck's WAV files to the bar's format and uploads them ahead of
   need, so that a sound plays on time. Uploads run one at a time and never
   delay drawing; a problem is one warning, and the moment's default sound
   plays instead: the trainer never loses the signal silently. */
import type { AssetsDeleteParams, AssetsUploadParams, AudioPlayParams, RequestOptions, StorageList, StorageReadDirectoryParams, SuccessResponse } from '@busy-app/busy-lib'
import type { Log } from './relay.ts'
import type { Sound, SoundPlayer } from './sounds.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile as fsReadFile } from 'node:fs/promises'
import { APPLICATION, deckFile, stockPlayer } from './sounds.ts'
import { decodeWav, MAX_SECONDS } from './wav.ts'

const UPLOAD_TIMEOUT_MS = 10_000
const STOCK_DIRECTORY = '/ext/apps_assets/shared/sounds'

/** What the store needs from a `BusyBar` client. */
export interface SoundBar {
  AssetsUpload: (params: AssetsUploadParams, options?: RequestOptions) => Promise<SuccessResponse>
  AssetsDelete: (params: AssetsDeleteParams, options?: RequestOptions) => Promise<SuccessResponse>
  StorageListGet: (params: StorageReadDirectoryParams, options?: RequestOptions) => Promise<StorageList>
}

export interface SoundStoreOptions {
  /** The deck's folder: WAV paths are relative to it, and must stay in it. */
  root: string
  readFile?: (path: string) => Promise<Uint8Array>
}

export function createSoundStore(bar: SoundBar, log: Log, options: SoundStoreOptions): SoundPlayer & {
  reset: () => void
  prepare: (sound: Sound) => void
  checkStock: (sounds: [string, Sound][]) => Promise<void>
  /** Logs `message` to the console, once. Shared so the plugin can report a
      slide's invalid or unknown `busy.sound` through the same de-duplication
      as the store's own warnings. */
  warnOnce: (message: string) => void
  idle: () => Promise<void>
} {
  const { root, readFile = fsReadFile } = options
  /* Asset of each deck file, by absolute path. */
  const ready = new Map<string, string>()
  /* Assets on the bar, by name: content-named, never uploaded twice. */
  const uploaded = new Set<string>()
  /* Files a miss in `resolve()` already queued a retry for: cleared once
     that job settles, so a run of misses queues one job, not one per miss. */
  const retrying = new Set<string>()
  const warned = new Set<string>()
  let queue: Promise<void> = Promise.resolve()

  function warnOnce(message: string) {
    if (warned.has(message))
      return
    warned.add(message)
    log.warn(message)
  }

  function enqueue(job: () => Promise<void>) {
    queue = queue.then(job).catch(error => log.debug?.(`sound store: ${(error as Error).message}`))
  }

  async function upload(file: string) {
    const full = deckFile(root, file)
    if (!full)
      return warnOnce(`${file}: only WAV files inside the deck's folder can be played; playing the default sound instead.`)
    let bytes: Uint8Array
    try {
      bytes = await readFile(full)
    }
    catch {
      return warnOnce(`${file}: not found; playing the default sound instead.`)
    }
    let decoded: ReturnType<typeof decodeWav>
    try {
      decoded = decodeWav(bytes)
    }
    catch (error) {
      return warnOnce(`${file}: ${(error as Error).message}. Convert it to WAV (ffmpeg -i ${file} ${file.replace(/\.[^./]*$/, '')}.converted.wav); playing the default sound instead.`)
    }
    if (decoded.truncated)
      warnOnce(`${file}: longer than ${MAX_SECONDS} s, cut at ${MAX_SECONDS} s.`)
    /* Int16Array is native-endian, and Node is little-endian on every
       platform it runs on: this matches what the firmware expects. */
    const data = Buffer.from(decoded.pcm.buffer, decoded.pcm.byteOffset, decoded.pcm.byteLength)
    const asset = `sounds/${createHash('sha1').update(data).digest('hex').slice(0, 12)}.snd`
    if (!uploaded.has(asset)) {
      try {
        await bar.AssetsUpload({ application_name: APPLICATION, file: asset, data }, { timeout: UPLOAD_TIMEOUT_MS })
      }
      catch (error) {
        /* The bar is away: the next prepare tries again. */
        log.debug?.(`sound ${file} not uploaded: ${(error as Error).message}`)
        return
      }
      uploaded.add(asset)
      log.debug?.(`sound ${file} uploaded as ${asset}`)
    }
    ready.set(full, asset)
  }

  return {
    /** Deletes the addon's previous sounds; queued before any upload. */
    reset() {
      enqueue(async () => {
        await bar.AssetsDelete({ application_name: APPLICATION }, { timeout: UPLOAD_TIMEOUT_MS }).catch(() => {})
        uploaded.clear()
        ready.clear()
      })
    },

    /** Converts and uploads a file sound in the background; stock sounds
        and silence need nothing. Reads the file again each time, so that an
        edited file is picked up; unchanged content is not uploaded again. */
    prepare(sound: Sound) {
      if (sound && 'file' in sound)
        enqueue(() => upload(sound.file))
    },

    resolve(sound: Sound, fallback: Sound): AudioPlayParams | null {
      if (sound && 'file' in sound) {
        const full = deckFile(root, sound.file)
        if (full) {
          const asset = ready.get(full)
          if (asset)
            return { application_name: APPLICATION, path: asset }
          /* Not ready: the bar may have been unreachable when this was first
             prepared. Queue a retry so a talk that outlasts the outage still
             gets the deck's sound, without piling up a job per miss. */
          if (!retrying.has(full)) {
            retrying.add(full)
            enqueue(() => upload(sound.file).finally(() => retrying.delete(full)))
          }
        }
      }
      return stockPlayer.resolve(sound, fallback)
    },

    /** Warns about stock names the bar does not have: it would play
        nothing. Quiet when the bar cannot be reached. */
    async checkStock(sounds: [string, Sound][]) {
      let names: string[]
      try {
        const { list } = await bar.StorageListGet({ path: STOCK_DIRECTORY }, { timeout: UPLOAD_TIMEOUT_MS })
        names = list.filter(entry => entry.type === 'file').map(entry => entry.name.replace(/\.snd$/, ''))
      }
      catch {
        return
      }
      for (const [key, sound] of sounds) {
        if (sound && 'stock' in sound && !names.includes(sound.stock))
          warnOnce(`${key}: no stock sound "${sound.stock}" on the bar (${names.join(', ')}).`)
      }
    },

    warnOnce,

    /** Resolves when every queued job is done (tests). */
    idle: () => queue,
  }
}
