/* Vite plugin of the Slidev dev server. `apply: 'serve'` keeps it out of
   `slidev build`. It reads the settings, creates the relay and wires the
   pieces: the deck's sounds (deck-sounds.ts), the bar's controls
   (bar-controls.ts), the user's config file (user-config.ts) and the routes
   the browser posts to (requests.ts).

   Settings in `.env.local` (never exposed to the browser, since they lack the
   `VITE_` prefix):
     BUSYBAR_ADDR      address of the bar (default 10.0.4.20, over USB)
     BUSYBAR_PASSWORD  HTTP access code of the bar, needed over Wi-Fi
     BUSYBAR_ENABLED   `false` turns the addon off
     BUSYBAR_DEBUG     `true` logs every call to the bar */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { resolve } from 'node:path'
import process from 'node:process'
import { BusyBar } from '@busy-app/busy-lib'
import { loadEnv } from 'vite'
import { wireBarControls } from './bar-controls.ts'
import { createDayStore, DAY_FILE } from './day-store.ts'
import { createDeckSounds } from './deck-sounds.ts'
import { createRelay, TIMEOUT_MS } from './relay.ts'
import { isTimerAction, parseSchedule, parseSlide, readJson, reply } from './requests.ts'
import { createSoundStore } from './sound-store.ts'
import { createUserConfig } from './user-config.ts'

export function busybar(): Plugin {
  let env: Record<string, string> = {}
  let root = process.cwd()
  let mode = 'development'

  return {
    name: 'slidev-addon-busybar',
    apply: 'serve',
    configResolved(config) {
      root = config.root
      mode = config.mode
      /* Slidev's root is the deck folder: read the project root too. */
      env = { ...loadEnv(mode, process.cwd(), 'BUSYBAR_'), ...loadEnv(mode, config.envDir || root, 'BUSYBAR_') }
    },
    async configureServer(server) {
      /* Slidev runs Vite with `--log warn`: write directly, so that the bar
         coming back is as visible as it going away. */
      const log = {
        info: (message: string) => console.log(`[busybar] ${message}`),
        warn: (message: string) => console.warn(`[busybar] ${message}`),
        debug: /^(?:true|1|yes|on)$/i.test(env.BUSYBAR_DEBUG ?? '')
          ? (message: string) => console.log(`[busybar] ${message}`)
          : undefined,
      }
      if (/^(?:false|0|no|off)$/i.test(env.BUSYBAR_ENABLED ?? '')) {
        log.info('disabled (BUSYBAR_ENABLED).')
        return
      }
      /* Sounds moved to busybar.config.ts: say where, once. */
      if (env.BUSYBAR_SOUND !== undefined)
        log.warn('BUSYBAR_SOUND is no longer used: set sounds.timeUp, sounds.breakOver and sounds.phaseEnd in busybar.config.ts.')
      if (env.BUSYBAR_WARN_SOUND !== undefined)
        log.warn('BUSYBAR_WARN_SOUND is no longer used: set sounds.breakWarning in busybar.config.ts.')

      const userConfig = createUserConfig(server, root, mode, log)
      const config = await userConfig.initial()

      const addr = env.BUSYBAR_ADDR || '10.0.4.20'
      const password = env.BUSYBAR_PASSWORD || undefined
      const bar = new BusyBar({ addr, HTTPAccessPassword: password, timeout: TIMEOUT_MS })
      const sounds = createSoundStore(bar, log, { root })
      const store = createDayStore(resolve(root, DAY_FILE), undefined, message => log.debug?.(message))
      const relay = createRelay(bar, log, { sounds, config, store })
      log.info(`relay to ${addr}${userConfig.name ? `, settings from ${userConfig.name}` : ''}.`)

      const deckSounds = createDeckSounds(server, sounds, root)
      sounds.reset()
      deckSounds.prepare(config)
      const controls = wireBarControls({ server, relay, log, addr, password }, config)
      userConfig.watch((next) => {
        relay.configure(next)
        controls.update(next)
        deckSounds.prepare(next)
      })

      server.middlewares.use('/__busy', (req, res) => {
        void handle(req, res)
      })
      server.httpServer?.once('close', () => {
        controls.close()
        void relay.close()
      })

      async function handle(req: IncomingMessage, res: ServerResponse) {
        if (req.method !== 'POST')
          return reply(res, 405)
        const body = await readJson(req)
        if (req.url === '/slide') {
          const slide = body && parseSlide(body)
          if (!slide)
            return reply(res, 400)
          reply(res, 204)
          relay.setSlide(slide)
          if (typeof slide.sound === 'string')
            deckSounds.slideSound(slide.sound)
          return
        }
        if (req.url === '/schedule') {
          const schedule = body && parseSchedule(body)
          if (!schedule)
            return reply(res, 400)
          reply(res, 204)
          relay.setSchedule(schedule)
          return
        }
        if (req.url === '/timer') {
          const action = body?.action
          if (!isTimerAction(action))
            return reply(res, 400)
          reply(res, 204)
          controls.timer(action)
          return
        }
        reply(res, 404)
      }
    },
  }
}
