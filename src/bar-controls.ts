/* The bar's wheel, buttons and switch, wired to the relay and to the deck:
   listens to the bar's state stream, turns raw inputs into the actions set
   in `controls`, plays timer actions in the relay and Slidev actions in one
   browser window over Vite's HMR socket (`busybar:action`, see
   `setup/shortcuts.ts`). Keyboard timer shortcuts come through here too, so
   that the wheel's setting is never bypassed. */
import type { ViteDevServer, WebSocketClient } from 'vite'
import type { ControlAction, Controls, ResolvedConfig, SlidevAction } from './config.ts'
import type { Log, Relay } from './relay.ts'
import type { TimerAction } from './timer.ts'
import { Button, createControls, SwitchPosition } from './input.ts'
import { listenToBar } from './stream.ts'

/* From the bar's controls to actions, following `controls` in
   `busybar.config.ts`. Timer actions stay in the dev server; the others are
   played by Slidev in the browser window the bar drives. */
const BUTTON_KEYS = {
  [Button.OK]: ['ok', 'okHold'],
  [Button.BACK]: ['back', 'backHold'],
  [Button.START]: ['start', 'startHold'],
} as const satisfies Record<Button, readonly [keyof Controls, keyof Controls]>

export function buttonAction(controls: Controls, button: Button, long: boolean): ControlAction {
  const keys = BUTTON_KEYS[button]
  return keys ? controls[keys[long ? 1 : 0]] as ControlAction : false
}

export function wheelAction(controls: Controls, delta: number): SlidevAction | false {
  if (!controls.wheel || !delta)
    return false
  if (controls.wheel === 'slides')
    return delta > 0 ? 'nextSlide' : 'prevSlide'
  return delta > 0 ? 'next' : 'prev'
}

const TIMER: Record<string, TimerAction> = { 'timer:toggle': 'toggle', 'timer:add': 'add', 'timer:skip': 'skip', 'timer:cancel': 'cancel' }

export type Routed = { timer: TimerAction } | { slidev: SlidevAction } | { set: true } | null

/** Where an action is played. */
export function route(action: ControlAction): Routed {
  if (!action)
    return null
  if (action === 'timer:set')
    return { set: true }
  return TIMER[action] ? { timer: TIMER[action] } : { slidev: action as SlidevAction }
}

/** While the setting is open, what an action (from a button or `/timer`)
    does to it: anything else is ignored, so that the setting is never
    bypassed. */
export function settingAction(action: TimerAction | ControlAction): 'start' | 'close' | null {
  if (action === 'toggle' || action === 'timer:toggle')
    return 'start'
  if (action === 'cancel' || action === 'timer:cancel' || action === 'timer:set')
    return 'close'
  return null
}

export interface BarControlsOptions {
  server: ViteDevServer
  relay: Relay
  log: Log
  addr: string
  password?: string
}

export function wireBarControls({ server, relay, log, addr, password }: BarControlsOptions, initial: ResolvedConfig) {
  let config = initial

  /* Browser windows showing the deck, most recent last. Audience and
     presenter windows sync their slide both ways: if both took a wheel
     notch, the deck could move twice. The presenter drives when open. */
  let windows: { client: WebSocketClient, presenter: boolean }[] = []
  server.ws.on('busybar:window', (data: { presenter?: unknown }, client) => {
    windows = windows.filter(w => w.client !== client)
    windows.push({ client, presenter: data?.presenter === true })
  })

  /** While the setting is open, an action either starts or closes it (or is
      ignored): it is never bypassed, whether it comes from a bar button or a
      keyboard shortcut. */
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
    if ('set' in target)
      return relay.openSetting()
    if ('timer' in target)
      return relay.timer(target.timer)
    windows = windows.filter(w => server.ws.clients.has(w.client))
    const window = windows.findLast(w => w.presenter) ?? windows.at(-1)
    window?.client.send('busybar:action', { action: target.slidev })
  }

  const controls = createControls({
    /* While a timer is being set, the wheel sets it and Start/Stop starts it
       instead of driving the deck. */
    step(delta) {
      if (!config.controls)
        return
      if (relay.setting())
        relay.adjust(delta)
      else
        play(wheelAction(config.controls, delta))
    },
    press(button, long) {
      if (!config.controls)
        return
      const action = buttonAction(config.controls, button, long)
      if (relay.setting())
        applyToSetting(action)
      else
        play(action)
    },
    holds: button => !!config.controls && buttonAction(config.controls, button, true) !== false,
    switched(position) {
      if (!config.controls?.switch)
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

  /** Applies a (re)loaded configuration: listens to the bar with `controls`,
      stops with `controls: false`. */
  function update(next: ResolvedConfig) {
    config = next
    if (next.controls && !stream) {
      stream = listenToBar(log, { addr, password, onInput: controls.input, onDisconnect: controls.reset })
    }
    else if (!next.controls && stream) {
      stream.close()
      stream = null
    }
  }

  /** A timer action from the keyboard (`b`, `+`, `Shift` + `x`). */
  function timer(action: TimerAction) {
    if (relay.setting())
      applyToSetting(action)
    else
      relay.timer(action)
  }

  update(initial)
  return { update, timer, close: () => stream?.close() }
}
