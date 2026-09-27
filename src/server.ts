/* Assembles the addon inside the Slidev dev server: the bar client, the
   relay, the deck's sounds, the bar's controls, the user's config file and
   the routes. The order matters and is written here once: the relay needs
   the sounds and the day store; the controls need the relay; a reloaded
   config reaches the relay, the controls and the sounds. */
import type { ViteDevServer } from 'vite'
import type { Log } from './log.ts'
import type { Settings } from './settings.ts'
import { resolve } from 'node:path'
import { BusyBar } from '@busy-app/busy-lib'
import { wireBarControls } from './bar-controls.ts'
import { createDayStore, DAY_FILE } from './day-store.ts'
import { createDeckSounds } from './deck-sounds.ts'
import { createRelay, TIMEOUT_MS } from './relay.ts'
import { createRoutes } from './routes.ts'
import { createSoundStore } from './sound-store.ts'
import { createUserConfig } from './user-config.ts'

export interface ServerContext {
  /** Vite's root: the deck's folder. */
  root: string
  mode: string
  settings: Settings
  log: Log
}

export async function startBusybar(server: ViteDevServer, { root, mode, settings, log }: ServerContext) {
  for (const warning of settings.warnings)
    log.warn(warning)

  const userConfig = createUserConfig(server, root, mode, log)
  const config = await userConfig.initial()

  const bar = new BusyBar({ addr: settings.addr, HTTPAccessPassword: settings.password, timeout: TIMEOUT_MS })
  const sounds = createSoundStore(bar, log, { root })
  const store = createDayStore(resolve(root, DAY_FILE), undefined, message => log.debug?.(message))
  const relay = createRelay(bar, log, { sounds, config, store })
  log.info(`relay to ${settings.addr}${userConfig.name ? `, settings from ${userConfig.name}` : ''}.`)

  const deckSounds = createDeckSounds(server, sounds, root)
  sounds.reset()
  deckSounds.prepare(config)
  const controls = wireBarControls({ server, relay, log, addr: settings.addr, password: settings.password }, config)
  userConfig.watch((next) => {
    relay.configure(next)
    controls.update(next)
    deckSounds.prepare(next)
  })

  const handle = createRoutes({
    slide(slide) {
      relay.setSlide(slide)
      /* Uploaded now, long before its timer can end. */
      if (typeof slide.sound === 'string')
        deckSounds.slideSound(slide.sound)
    },
    schedule: schedule => relay.setSchedule(schedule),
    timer: action => controls.timer(action),
  })
  server.middlewares.use('/__busy', (req, res) => {
    void handle(req, res)
  })
  server.httpServer?.once('close', () => {
    controls.close()
    void relay.close()
  })
}
