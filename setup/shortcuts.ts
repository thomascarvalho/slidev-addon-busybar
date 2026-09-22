/* BUSY Bar timer shortcuts, added to Slidev's default ones, and the actions
   of the bar's own buttons and wheel.

   `b` and `.` are the keys sent by the "blank screen" button of presentation
   remotes: one button is enough to start, pause, resume and move a workshop
   to its next phase. The other two stay on the keyboard, and cancelling
   needs Shift so that it does not happen by accident.

     b  or  .      start / pause / resume / next phase (and acknowledge "Time's up")
     +  or  =      one more minute
     Shift + x     cancel the timer */
import type { NavOperations, ShortcutOptions } from '@slidev/types'
import type { SlidevAction } from '../src/config'
import type { TimerAction } from '../src/timer'
import { useNav } from '@slidev/client'
import { defineShortcutsSetup } from '@slidev/types'
import { getCurrentScope, onScopeDispose, watch } from 'vue'

function timer(action: TimerAction) {
  fetch('/__busy/timer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {})
}

/** Plays the Slidev actions the dev server sends when a control of the bar
    is used (`controls` in `busybar.config.ts`). The server picks a single
    window, the presenter when open: audience and presenter sync their slide
    both ways, and both moving would skip a slide. */
function followBar(nav: NavOperations) {
  const hot = import.meta.hot
  const { isPresenter, isPrintMode, isEmbedded, total } = useNav()
  if (!hot || isPrintMode.value || isEmbedded.value)
    return

  const actions: Record<string, () => unknown> = {
    next: nav.next,
    prev: nav.prev,
    nextSlide: nav.nextSlide,
    prevSlide: nav.prevSlide,
    first: nav.goFirst,
    last: nav.goLast,
    overview: nav.toggleOverview,
    dark: nav.toggleDark,
  }
  /* Actions are played one after the other, even when notches come in
     bursts. */
  let queue: Promise<unknown> = Promise.resolve()
  const play = ({ action }: { action: SlidevAction }) => {
    const no = /^goto:(\d+)$/.exec(action)?.[1]
    const fn = no ? () => nav.go(Math.min(Number(no), total.value)) : actions[action]
    if (fn)
      queue = queue.then(fn).catch(() => {})
  }
  const announce = () => hot.send('busybar:window', { presenter: isPresenter.value })

  announce()
  const stop = watch(isPresenter, announce)
  hot.on('vite:ws:connect', announce)
  hot.on('busybar:action', play)
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop()
      hot.off('vite:ws:connect', announce)
      hot.off('busybar:action', play)
    })
  }
}

export default defineShortcutsSetup((nav, base: ShortcutOptions[]) => {
  /* The relay only exists on the dev server. */
  if (!import.meta.env.DEV)
    return base
  followBar(nav)
  return [
    ...base,
    { name: 'busy_timer_toggle', key: 'b', fn: () => timer('toggle') },
    { name: 'busy_timer_toggle_remote', key: '.', fn: () => timer('toggle') },
    { name: 'busy_timer_add', key: '+', fn: () => timer('add') },
    { name: 'busy_timer_add_equal', key: '=', fn: () => timer('add') },
    { name: 'busy_timer_cancel', key: 'shift+x', fn: () => timer('cancel') },
  ]
})
