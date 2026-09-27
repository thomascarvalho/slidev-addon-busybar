/* The deck's own sounds, kept ready on the bar: the WAV files named in
   `busybar.config.ts` (watched, uploaded again when edited or created) and
   the one a slide names in `busy.sound` (uploaded when the slide is shown,
   long before its timer can end). Invalid values warn once and never block
   anything: the deck's sound plays instead. */
import type { ViteDevServer } from 'vite'
import type { ResolvedConfig } from './config.ts'
import type { createSoundStore } from './sound-store.ts'
import type { Sound } from './sounds.ts'
import { relative, resolve } from 'node:path'
import { deckFile, invalidSoundMessage, parseSound, STOCK_SOUNDS } from './sounds.ts'

type SoundStore = ReturnType<typeof createSoundStore>

export function createDeckSounds(server: ViteDevServer, sounds: SoundStore, root: string) {
  const watched = new Set<string>()

  /** Uploads the configuration's files and watches them; checks its stock
      names. */
  function prepare(config: ResolvedConfig) {
    for (const sound of Object.values(config.sounds)) {
      sounds.prepare(sound)
      const full = sound && 'file' in sound ? deckFile(root, sound.file) : null
      if (full && !watched.has(full)) {
        watched.add(full)
        server.watcher.add(full)
      }
    }
    void sounds.checkStock(Object.entries(config.sounds).map(([key, sound]): [string, Sound] => [`sounds.${key}`, sound]))
  }

  /** A slide's `busy.sound`, as posted by the browser. */
  function slideSound(value: string) {
    const own = parseSound(value)
    if (own === undefined)
      sounds.warnOnce(invalidSoundMessage(value))
    else if (own && 'stock' in own && !STOCK_SOUNDS.includes(own.stock))
      sounds.warnOnce(`busy.sound: no stock sound "${own.stock}" (${STOCK_SOUNDS.join(', ')}).`)
    else if (own)
      sounds.prepare(own)
  }

  /* `add` too: a deck WAV created after the "not found" warning is picked up
     without restarting the server. */
  function onFile(file: string) {
    if (watched.has(resolve(file)))
      sounds.prepare({ file: relative(root, resolve(file)) })
  }
  server.watcher.on('change', onFile)
  server.watcher.on('add', onFile)

  return { prepare, slideSound }
}
