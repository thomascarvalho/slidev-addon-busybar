/* BUSY Bar timer shortcuts, added to Slidev's default ones.

   `b` and `.` are the keys sent by the "blank screen" button of presentation
   remotes: one button is enough to start, pause and resume. The other two
   stay on the keyboard, and cancelling needs Shift so that it does not happen
   by accident.

     b  or  .      start / pause / resume (and acknowledge "Time's up")
     +  or  =      one more minute
     Shift + x     cancel the timer */
import type { ShortcutOptions } from '@slidev/types'
import type { TimerAction } from '../src/timer'
import { defineShortcutsSetup } from '@slidev/types'

function timer(action: TimerAction) {
  fetch('/__busy/timer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {})
}

export default defineShortcutsSetup((_nav, base: ShortcutOptions[]) => {
  /* The relay only exists on the dev server. */
  if (!import.meta.env.DEV)
    return base
  return [
    ...base,
    { name: 'busy_timer_toggle', key: 'b', fn: () => timer('toggle') },
    { name: 'busy_timer_toggle_remote', key: '.', fn: () => timer('toggle') },
    { name: 'busy_timer_add', key: '+', fn: () => timer('add') },
    { name: 'busy_timer_add_equal', key: '=', fn: () => timer('add') },
    { name: 'busy_timer_cancel', key: 'shift+x', fn: () => timer('cancel') },
  ]
})
