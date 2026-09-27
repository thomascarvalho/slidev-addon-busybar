/* The `.env.local` settings, read once into a typed object (never exposed to
   the browser, since they lack the `VITE_` prefix):
     BUSYBAR_ADDR      address of the bar (default 10.0.4.20, over USB)
     BUSYBAR_PASSWORD  HTTP access code of the bar, needed over Wi-Fi
     BUSYBAR_ENABLED   `false` turns the addon off
     BUSYBAR_DEBUG     `true` logs every call to the bar */

export interface Settings {
  addr: string
  password: string | undefined
  enabled: boolean
  debug: boolean
  /** Variables that no longer do anything, one line each. */
  warnings: string[]
}

export const DEFAULT_ADDR = '10.0.4.20'

const YES = /^(?:true|1|yes|on)$/i
const NO = /^(?:false|0|no|off)$/i

/* Sounds moved to busybar.config.ts in 0.3.0: say where. */
const RETIRED: Record<string, string> = {
  BUSYBAR_SOUND: 'BUSYBAR_SOUND is no longer used: set sounds.timeUp, sounds.breakOver and sounds.phaseEnd in busybar.config.ts.',
  BUSYBAR_WARN_SOUND: 'BUSYBAR_WARN_SOUND is no longer used: set sounds.breakWarning in busybar.config.ts.',
}

export function readSettings(env: Record<string, string | undefined>): Settings {
  return {
    addr: env.BUSYBAR_ADDR || DEFAULT_ADDR,
    password: env.BUSYBAR_PASSWORD || undefined,
    enabled: !NO.test(env.BUSYBAR_ENABLED ?? ''),
    debug: YES.test(env.BUSYBAR_DEBUG ?? ''),
    warnings: Object.keys(RETIRED).filter(name => env[name] !== undefined).map(name => RETIRED[name]),
  }
}
