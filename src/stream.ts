/* Listens to the bar's state stream (`/api/status/ws`) for its buttons, wheel
   and switch. busy-lib's `LocalStateStream` runs in a browser Web Worker, so
   the dev server opens the socket itself.

   Like the relay, it never holds the talk back: a missing bar is one log
   line, then a quiet retry. The bar sends something every second; on firmware
   1.2.4 the stream sometimes goes silent without closing, so silence is
   treated as a disconnection. */
import type { Log } from './relay.ts'
import type { BarInput } from './input.ts'
import { decodeInputs } from './input.ts'

const SILENCE_MS = 5000
const RETRY_MS = 5000

export interface StreamOptions {
  addr: string
  password?: string
  onInput: (input: BarInput) => void
  /** Called when the connection drops, so that half-seen presses are
      forgotten. */
  onDisconnect?: () => void
}

export function listenToBar(log: Log, options: StreamOptions) {
  const url = new URL(`ws://${options.addr.replace(/^\w+:\/\//, '').replace(/\/+$/, '')}/api/status/ws`)
  if (options.password)
    url.searchParams.set('x-api-token', options.password)

  let socket: WebSocket | null = null
  /* The current socket has received something. */
  let alive = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let failing = false
  let closed = false

  if (typeof WebSocket === 'undefined') {
    log.warn('the bar\'s buttons and wheel need Node 22 or later.')
    return { close() {} }
  }

  function connect() {
    if (closed)
      return
    const ws = new WebSocket(url)
    socket = ws
    alive = false
    ws.binaryType = 'arraybuffer'
    watch()
    ws.addEventListener('open', () => {
      /* What busy-lib's worker sends to start the stream. */
      ws.send(JSON.stringify({ enable: true }))
    })
    ws.addEventListener('message', (event) => {
      if (ws !== socket)
        return
      watch()
      alive = true
      if (failing) {
        failing = false
        log.info('bar buttons and wheel connected again.')
      }
      if (event.data instanceof ArrayBuffer) {
        for (const input of decodeInputs(new Uint8Array(event.data))) {
          log.debug?.(`input: ${JSON.stringify(input)}`)
          options.onInput(input)
        }
      }
    })
    ws.addEventListener('close', () => drop(ws, 'connection closed'))
    ws.addEventListener('error', () => drop(ws, 'connection failed'))
  }

  function watch() {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => drop(socket, alive ? 'silent' : 'no answer'), SILENCE_MS)
  }

  /** Gives up on `ws` and reconnects, once per socket. */
  function drop(ws: WebSocket | null, reason: string) {
    if (!ws || ws !== socket)
      return
    socket = null
    clearTimeout(watchdog)
    try {
      ws.close()
    }
    catch {}
    options.onDisconnect?.()
    if (closed)
      return
    if (!failing)
      log.debug?.(`input stream ${reason}, reconnecting.`)
    /* A silent stream is common and fixed by reconnecting at once; a refused
       connection means the bar is away: log it once, then retry quietly. */
    if (reason === 'silent') {
      connect()
      return
    }
    if (!failing)
      log.warn(`bar buttons and wheel unavailable (${reason}); retrying every 5 s.`)
    failing = true
    clearTimeout(retry)
    retry = setTimeout(connect, RETRY_MS)
  }

  connect()

  return {
    close() {
      closed = true
      clearTimeout(retry)
      drop(socket, 'closed')
    },
  }
}
