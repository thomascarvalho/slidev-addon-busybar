/* The day (`Day` of schedule.ts) saved next to the deck, so that a restart
   of the dev server in the middle of a training keeps the start and the
   entries. Only today's file is loaded. */
import type { DayStore } from './day.ts'
import type { Day } from './schedule.ts'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { messageOf } from './errors.ts'

export const DAY_FILE = '.busybar-day.json'

/** `2026-09-06`, local time. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function createDayStore(file: string, today: () => string = () => localDate(), warn?: (message: string) => void): DayStore {
  return {
    load() {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { date?: unknown, startedAt?: unknown, entered?: unknown }
        if (raw?.date !== today() || typeof raw.entered !== 'object' || raw.entered === null)
          return null
        const entered = Object.fromEntries(Object.entries(raw.entered).filter((e): e is [string, number] => typeof e[1] === 'number'))
        const startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : null
        /* Entries without a start would leave the day without an origin. */
        if (startedAt === null && Object.keys(entered).length)
          return null
        return { startedAt, entered }
      }
      catch {
        return null
      }
    },
    async save(day: Day) {
      try {
        await writeFile(file, JSON.stringify({ date: today(), ...day }))
      }
      catch (error) {
        warn?.(`day not saved to ${file}: ${messageOf(error)}`)
      }
    },
  }
}
