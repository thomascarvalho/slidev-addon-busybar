/* The addon's console lines, prefixed. Slidev runs Vite with `--log warn`,
   so we write to the console directly: the bar coming back must be as
   visible as it going away. */

export interface Log {
  info: (message: string) => void
  warn: (message: string) => void
  /** Every call to the bar, with `BUSYBAR_DEBUG=true`. */
  debug?: (message: string) => void
}

const PREFIX = '[busybar]'

export function createLog(debug: boolean): Log {
  return {
    info: message => console.log(`${PREFIX} ${message}`),
    warn: message => console.warn(`${PREFIX} ${message}`),
    debug: debug ? message => console.log(`${PREFIX} ${message}`) : undefined,
  }
}
