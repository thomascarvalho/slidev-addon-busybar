/* From the bar's controls to actions, following `controls` in
   `busybar.config.ts`. Timer actions stay in the dev server; the others are
   played by Slidev in the browser window the bar drives. */
import type { ControlAction, Controls, SlidevAction } from './config.ts'
import type { TimerAction } from './timer.ts'
import { Button } from './input.ts'

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

const TIMER: Record<string, TimerAction> = { 'timer:toggle': 'toggle', 'timer:add': 'add', 'timer:cancel': 'cancel' }

export type Routed = { timer: TimerAction } | { slidev: SlidevAction } | null

/** Where an action is played. */
export function route(action: ControlAction): Routed {
  if (!action)
    return null
  return TIMER[action] ? { timer: TIMER[action] } : { slidev: action as SlidevAction }
}
