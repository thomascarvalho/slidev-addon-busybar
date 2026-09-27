/* Vite plugin of the Slidev dev server. `apply: 'serve'` keeps it out of
   `slidev build`. It reads `.env.local` (settings.ts) and hands the server
   to `startBusybar` (server.ts), which assembles everything. */
import type { Plugin } from 'vite'
import type { Settings } from './settings.ts'
import process from 'node:process'
import { loadEnv } from 'vite'
import { createLog } from './log.ts'
import { startBusybar } from './server.ts'
import { readSettings } from './settings.ts'

export function busybar(): Plugin {
  let context: { root: string, mode: string, settings: Settings } | null = null

  return {
    name: 'slidev-addon-busybar',
    apply: 'serve',
    configResolved(config) {
      /* Slidev's root is the deck folder: read the project root too. */
      const env = { ...loadEnv(config.mode, process.cwd(), 'BUSYBAR_'), ...loadEnv(config.mode, config.envDir || config.root, 'BUSYBAR_') }
      context = { root: config.root, mode: config.mode, settings: readSettings(env) }
    },
    async configureServer(server) {
      const { root, mode, settings } = context ?? { root: process.cwd(), mode: 'development', settings: readSettings({}) }
      const log = createLog(settings.debug)
      if (!settings.enabled)
        return log.info('disabled (BUSYBAR_ENABLED).')
      await startBusybar(server, { root, mode, settings, log })
    },
  }
}
