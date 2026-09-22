/* Vite plugin of the Slidev dev server: receives slides on `/__busy/*` and
   hands them to the relay. `apply: 'serve'` keeps it out of `slidev build`.

   Settings in `.env.local` (never exposed to the browser, since they lack the
   `VITE_` prefix):
     BUSYBAR_ADDR      address of the bar (default 10.0.4.20, over USB)
     BUSYBAR_PASSWORD  HTTP access code of the bar, needed over Wi-Fi
     BUSYBAR_ENABLED   `false` turns the addon off
     BUSYBAR_DEBUG     `true` logs every call to the bar

   Display settings live in an optional `busybar.config.ts` next to
   `slides.md`, reloaded when it changes.

   Its `sounds` and the slides' `busy.sound` may name WAV files of the deck:
   they are converted and uploaded to the bar ahead of need (sound-store.ts).

   The bar's wheel, buttons and switch come back through its state stream and
   play the actions set in `controls`: the timer is handled here, Slidev
   actions are sent to one browser window over Vite's HMR socket
   (`busybar:action`, see `setup/shortcuts.ts`). */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, WebSocketClient } from 'vite'
import type { BusybarConfig, ControlAction, ResolvedConfig } from './config.ts'
import type { Sound } from './sounds.ts'
import type { TimerAction } from './timer.ts'
import type { SlideInfo } from './types.ts'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import process from 'node:process'
import { BusyBar } from '@busy-app/busy-lib'
import { loadConfigFromFile, loadEnv } from 'vite'
import { resolveConfig } from './config.ts'
import { buttonAction, route, settingAction, wheelAction } from './controls.ts'
import { createControls, SwitchPosition } from './input.ts'
import { createRelay, TIMEOUT_MS } from './relay.ts'
import { createSoundStore } from './sound-store.ts'
import { deckFile, invalidSoundMessage, parseSound, STOCK_SOUNDS } from './sounds.ts'
import { listenToBar } from './stream.ts'

const MAX_BODY = 4096
const CONFIG_FILES = ['busybar.config.ts', 'busybar.config.mts', 'busybar.config.js', 'busybar.config.mjs']

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

      const configFile = CONFIG_FILES.map(name => resolve(root, name)).find(existsSync)
      async function loadUserConfig() {
        if (!configFile)
          return resolveConfig()
        const loaded = await loadConfigFromFile({ command: 'serve', mode }, configFile, root, 'silent')
        for (const dependency of loaded?.dependencies ?? [])
          server.watcher.add(dependency)
        return resolveConfig((loaded?.config ?? {}) as BusybarConfig)
      }

      let config
      try {
        config = await loadUserConfig()
      }
      catch (error) {
        log.warn(`${configFile}: ${(error as Error).message}. Using the defaults.`)
        config = resolveConfig()
      }

      const addr = env.BUSYBAR_ADDR || '10.0.4.20'
      const bar = new BusyBar({ addr, HTTPAccessPassword: env.BUSYBAR_PASSWORD || undefined, timeout: TIMEOUT_MS })
      const sounds = createSoundStore(bar, log, { root })
      const relay = createRelay(bar, log, { sounds, config })
      log.info(`relay to ${addr}${configFile ? `, settings from ${CONFIG_FILES.find(name => configFile.endsWith(name))}` : ''}.`)

      /* The deck's WAV files, watched: an edited file is uploaded again. */
      const watchedSounds = new Set<string>()
      function prepareSounds(next: ResolvedConfig) {
        for (const sound of Object.values(next.sounds)) {
          sounds.prepare(sound)
          const full = sound && 'file' in sound ? deckFile(root, sound.file) : null
          if (full && !watchedSounds.has(full)) {
            watchedSounds.add(full)
            server.watcher.add(full)
          }
        }
        void sounds.checkStock(Object.entries(next.sounds).map(([key, sound]): [string, Sound] => [`sounds.${key}`, sound]))
      }
      sounds.reset()
      prepareSounds(config)
      /* `add` too: a deck WAV created after the "not found" warning is
         picked up without restarting the server. */
      function onSoundFile(file: string) {
        if (watchedSounds.has(resolve(file)))
          sounds.prepare({ file: relative(root, resolve(file)) })
      }
      server.watcher.on('change', onSoundFile)
      server.watcher.on('add', onSoundFile)

      /* Browser windows showing the deck, most recent last. Audience and
         presenter windows sync their slide both ways: if both took a wheel
         notch, the deck could move twice. The presenter drives when open. */
      let windows: { client: WebSocketClient, presenter: boolean }[] = []
      server.ws.on('busybar:window', (data: { presenter?: unknown }, client) => {
        windows = windows.filter(w => w.client !== client)
        windows.push({ client, presenter: data?.presenter === true })
      })
      /* While the setting is open, an action either starts or closes it (or
         is ignored): it is never bypassed, whether it comes from a bar
         button or a keyboard shortcut (`/timer`). */
      function applyToSetting(action: TimerAction | ControlAction) {
        const mapped = settingAction(action)
        if (mapped === 'start')
          relay.startSetting()
        else if (mapped === 'close')
          relay.closeSetting()
      }
      function play(action: ControlAction) {
        const target = route(action)
        if (!target)
          return
        log.debug?.(`control: ${action}`)
        if ('set' in target) {
          relay.openSetting()
          return
        }
        if ('timer' in target) {
          relay.timer(target.timer)
          return
        }
        windows = windows.filter(w => server.ws.clients.has(w.client))
        const window = windows.findLast(w => w.presenter) ?? windows.at(-1)
        window?.client.send('busybar:action', { action: target.slidev })
      }

      let current = config
      const controls = createControls({
        /* While a timer is being set, the wheel sets it and Start/Stop
           starts it instead of driving the deck. */
        step(delta) {
          if (!current.controls)
            return
          if (relay.setting())
            relay.adjust(delta)
          else
            play(wheelAction(current.controls, delta))
        },
        press(button, long) {
          if (!current.controls)
            return
          const action = buttonAction(current.controls, button, long)
          if (relay.setting())
            applyToSetting(action)
          else
            play(action)
        },
        holds: button => !!current.controls && buttonAction(current.controls, button, true) !== false,
        switched(position) {
          if (!current.controls?.switch)
            return
          if (position === SwitchPosition.APPS) {
            log.info('switch back on APPS.')
            relay.redraw()
          }
          else {
            const name = Object.keys(SwitchPosition).find(k => SwitchPosition[k as keyof typeof SwitchPosition] === position)
            log.info(`switch on ${name ?? position}: the bar shows its own screen until it is back on APPS.`)
          }
        },
      })
      let stream: { close: () => void } | null = null
      function syncControls(next: ResolvedConfig) {
        current = next
        if (next.controls && !stream) {
          stream = listenToBar(log, {
            addr,
            password: env.BUSYBAR_PASSWORD || undefined,
            onInput: controls.input,
            onDisconnect: controls.reset,
          })
        }
        else if (!next.controls && stream) {
          stream.close()
          stream = null
        }
      }
      syncControls(config)

      if (configFile) {
        server.watcher.add(configFile)
        server.watcher.on('change', (file) => {
          if (resolve(file) !== configFile)
            return
          loadUserConfig()
            .then((next) => {
              relay.configure(next)
              syncControls(next)
              prepareSounds(next)
              log.info('settings reloaded.')
            })
            .catch(error => log.warn(`${configFile}: ${(error as Error).message}. Keeping the previous settings.`))
        })
      }

      server.middlewares.use('/__busy', (req, res) => {
        void handle(req, res)
      })
      server.httpServer?.once('close', () => {
        stream?.close()
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
          /* Uploaded now, long before its timer can end. An invalid value or
             an unknown stock name keeps the deck's sound, with a warning: it
             never blocks the slide. */
          if (typeof slide.sound === 'string') {
            const own = parseSound(slide.sound)
            if (own === undefined)
              sounds.warnOnce(invalidSoundMessage(slide.sound))
            else if (own && 'stock' in own && !STOCK_SOUNDS.includes(own.stock))
              sounds.warnOnce(`busy.sound: no stock sound "${own.stock}" (${STOCK_SOUNDS.join(', ')}).`)
            else if (own)
              sounds.prepare(own)
          }
          return
        }
        if (req.url === '/timer') {
          const action = body?.action
          if (!isTimerAction(action))
            return reply(res, 400)
          reply(res, 204)
          if (relay.setting())
            applyToSetting(action)
          else
            relay.timer(action)
          return
        }
        reply(res, 404)
      }
    },
  }
}

function isTimerAction(value: unknown): value is TimerAction {
  return value === 'toggle' || value === 'add' || value === 'skip' || value === 'cancel'
}

function reply(res: ServerResponse, status: number) {
  res.statusCode = status
  res.end()
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY)
      return null
  }
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  }
  catch {
    return null
  }
}

const MAX_PHASES = 10

function str(value: unknown): string | null {
  if (typeof value === 'number')
    return String(value)
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

function strs(value: unknown): string[] | null {
  const list = (Array.isArray(value) ? value : [value]).map(str).filter((s): s is string => s !== null).slice(0, MAX_PHASES)
  return list.length ? list : null
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export function parseSlide(body: Record<string, unknown>): SlideInfo | null {
  const no = int(body.no)
  if (no === null)
    return null
  const p = body.progress as { index?: unknown, count?: unknown } | null
  const index = int(p?.index)
  const count = int(p?.count)
  return {
    no,
    title: str(body.title),
    chapter: str(body.chapter),
    chapterNo: int(body.chapterNo) || null,
    progress: index && count && index <= count ? { index, count } : null,
    activity: str(body.activity),
    timer: strs(body.timer),
    screen: str(body.screen),
    until: str(body.until),
    text: str(body.text),
    sound: body.sound === false ? false : str(body.sound),
  }
}
