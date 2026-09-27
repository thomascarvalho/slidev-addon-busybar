/* The optional `busybar.config.ts` next to `slides.md`: found, loaded with
   Vite (so that it may be TypeScript and import things), and reloaded when
   it or one of its imports changes. */
import type { ViteDevServer } from 'vite'
import type { BusybarConfig, ResolvedConfig } from './config.ts'
import type { Log } from './relay.ts'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfigFromFile } from 'vite'
import { resolveConfig } from './config.ts'

const CONFIG_FILES = ['busybar.config.ts', 'busybar.config.mts', 'busybar.config.js', 'busybar.config.mjs']

export function createUserConfig(server: ViteDevServer, root: string, mode: string, log: Log) {
  const file = CONFIG_FILES.map(name => resolve(root, name)).find(existsSync)

  /** Loads the file; throws when it cannot be read or is invalid. */
  async function load(): Promise<ResolvedConfig> {
    if (!file)
      return resolveConfig()
    const loaded = await loadConfigFromFile({ command: 'serve', mode }, file, root, 'silent')
    for (const dependency of loaded?.dependencies ?? [])
      server.watcher.add(dependency)
    return resolveConfig((loaded?.config ?? {}) as BusybarConfig)
  }

  /** The configuration to start with: the defaults when the file is broken,
      with one warning. */
  async function initial(): Promise<ResolvedConfig> {
    try {
      return await load()
    }
    catch (error) {
      log.warn(`${file}: ${(error as Error).message}. Using the defaults.`)
      return resolveConfig()
    }
  }

  /** Calls `onChange` with the new configuration whenever the file is
      saved; a broken save keeps the previous one, with a warning. */
  function watch(onChange: (config: ResolvedConfig) => void) {
    if (!file)
      return
    server.watcher.add(file)
    server.watcher.on('change', (changed) => {
      if (resolve(changed) !== file)
        return
      load()
        .then((next) => {
          onChange(next)
          log.info('settings reloaded.')
        })
        .catch(error => log.warn(`${file}: ${(error as Error).message}. Keeping the previous settings.`))
    })
  }

  return {
    /** The file's name, for the console; `undefined` without one. */
    name: file ? CONFIG_FILES.find(name => file.endsWith(name)) : undefined,
    initial,
    watch,
  }
}
