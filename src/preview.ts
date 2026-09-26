/* Draws every state on a real bar and saves a screenshot of each:
     npm run preview -- <folder>
   Needs BUSYBAR_ADDR (and BUSYBAR_PASSWORD over Wi-Fi) in `.env.local`. It
   draws as its own application at a higher priority, then clears. */
import type { RenderState } from './render.ts'
import type { Timer } from './timer.ts'
import type { Schedule, SlideInfo } from './types.ts'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { BusyBar } from '@busy-app/busy-lib'
import { resolveConfig } from './config.ts'
import { rect } from './draw.ts'
import { renderBack } from './render-back.ts'
import { render } from './render.ts'
import { EMPTY_DAY, enter } from './schedule.ts'

const out = process.argv[2]
if (!out) {
  console.error('Usage: npm run preview -- <folder>')
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })

const APPLICATION = 'slidev-preview'
const bar = new BusyBar({ addr: process.env.BUSYBAR_ADDR, HTTPAccessPassword: process.env.BUSYBAR_PASSWORD, timeout: 6000 })
const config = resolveConfig({ logos: { box: () => [rect('logo', 20, 2, 32, 12, '#FF8FB1')] } })
const now = Date.now()
const slide = (extra: Partial<SlideInfo>): SlideInfo => ({ no: 1, title: null, chapter: 'Hooks', chapterNo: 1, progress: { index: 2, count: 5 }, activity: null, timer: null, screen: null, until: null, text: null, sound: null, ...extra })
const timer = (leftMs: number, running = true): Timer => ({ label: 'Workshop 1', style: null, phases: [{ label: null, ms: 15 * 60_000 }], index: 0, totalMs: 15 * 60_000, endsAt: running ? now + leftMs : null, leftMs, rang: false, warned: false })
const lab = (index: number, endsAt: number | null): Timer => ({ ...timer(0), label: 'Lab', phases: [{ label: 'Reading', ms: 300_000 }, { label: 'Coding', ms: 600_000 }, { label: 'Sharing', ms: 300_000 }], index, totalMs: [300_000, 600_000, 300_000][index], endsAt, leftMs: 0 })

const base = { setting: null, schedule: null, day: EMPTY_DAY }
const states: Record<string, RenderState> = {
  'chapter': { ...base, slide: slide({}), timer: null },
  'chapter-accents': { ...base, slide: slide({ chapter: 'Réseau & sécurité', chapterNo: 2 }), timer: null },
  'section': { ...base, slide: slide({ chapter: null, progress: null, title: 'Part 1' }), timer: null },
  'break': { ...base, slide: slide({ screen: 'break', until: '10:45' }), timer: null },
  'welcome': { ...base, slide: slide({ screen: 'welcome' }), timer: null },
  'questions': { ...base, slide: slide({ screen: 'questions' }), timer: null },
  'logo': { ...base, slide: slide({ screen: 'box' }), timer: null },
  'activity': { ...base, slide: slide({ activity: 'Workshop 1', timer: ['15m'] }), timer: null },
  'timer-green': { ...base, slide: null, timer: timer(754_000) },
  'timer-short-label': { ...base, slide: null, timer: { ...timer(754_000), label: 'Quiz' } },
  'timer-orange': { ...base, slide: null, timer: timer(150_000) },
  'timer-red': { ...base, slide: null, timer: timer(42_000) },
  'timer-paused': { ...base, slide: null, timer: timer(754_000, false) },
  'time-up': { ...base, slide: null, timer: timer(-5000) },
  'break-ready': { ...base, slide: slide({ screen: 'break', timer: ['15m'] }), timer: null },
  'break-running': { ...base, slide: slide({ screen: 'break', timer: ['15m'] }), timer: { ...timer(754_000), label: 'Break', style: 'break' } },
  'break-last-minute': { ...base, slide: null, timer: { ...timer(42_000), label: 'Break', style: 'break' } },
  'break-over': { ...base, slide: null, timer: { ...timer(-5000), label: 'Break', style: 'break' } },
  'lab-ready': { ...base, slide: slide({ activity: 'Lab', timer: ['5m Reading', '10m Coding', '5m Sharing'] }), timer: null },
  'lab-coding': { ...base, slide: null, timer: lab(1, now + 300_000) },
  'lab-next': { ...base, slide: null, timer: lab(0, now - 5_000) },
  'lab-next-led': { ...base, slide: null, timer: lab(0, now - 40_000) },
  'setting': { ...base, slide: slide({}), timer: null, setting: { ms: 7 * 60_000, until: now + 15_000 } },
}

/* "Time's up", "Break's over!" and the setting captured while lit. */
const at = (name: string) => name === 'time-up' || name === 'break-over' || name === 'setting' ? now - (now % 1000) : now

function png(px: Uint8Array, file: string, W = 72, H = 16, S = 10) {
  const row = W * S * 3 + 1
  const raw = Buffer.alloc(row * H * S)
  for (let y = 0; y < H * S; y++) {
    for (let x = 0; x < W * S; x++) {
      const i = (Math.floor(y / S) * W + Math.floor(x / S)) * 4
      const o = y * row + 1 + x * 3
      const grid = x % S === 0 || y % S === 0
      raw[o] = grid ? 40 : px[i]
      raw[o + 1] = grid ? 40 : px[i + 1]
      raw[o + 2] = grid ? 40 : px[i + 2]
    }
  }
  const crc = (b: Buffer) => {
    let c = ~0
    for (const v of b) {
      c ^= v
      for (let k = 0; k < 8; k++)
        c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(W * S, 0)
  header.writeUInt32BE(H * S, 4)
  header[8] = 8
  header[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

for (const [name, state] of Object.entries(states)) {
  await bar.DisplayClear({ application_name: APPLICATION })
  await bar.DisplayDraw({ application_name: APPLICATION, priority: 60, elements: render(state, at(name), config).elements })
  await new Promise(resolve => setTimeout(resolve, 500))
  const px = await bar.DisplayScreenFrameGet({ display: 0 }, { dataType: 'binary', format: 'rgba' })
  png(px!, path.join(out, `${name}.png`))
  console.log(name)
}

/* The back display, by state; captured from the back screen (display 1). */
const day = (h: number, m: number) => new Date(new Date(now).setHours(h, m, 0, 0)).getTime()
const deck: Schedule = {
  start: 9 * 60,
  end: 17 * 60,
  warnings: [],
  steps: [
    { from: 2, kind: 'chapter', label: 'Hooks', durationMs: 45 * 60_000, at: null },
    { from: 6, kind: 'break', label: null, durationMs: 15 * 60_000, at: null },
    { from: 7, kind: 'chapter', label: 'Référencer du code', durationMs: 60 * 60_000, at: null },
    { from: 12, kind: 'break', label: 'Déjeuner', durationMs: 60 * 60_000, at: 12 * 60 + 30 },
  ],
}
const hooks = enter(deck, EMPTY_DAY, 0, day(9, 12))
/* Timer scenes run at the real time: a schedule that started 30 min ago, on time. */
const live: Schedule = { ...deck, start: Math.floor((now - new Date(now).setHours(0, 0, 0, 0)) / 60_000) - 30, steps: deck.steps.map(s => ({ ...s, at: null })) }
const onTime = enter(live, EMPTY_DAY, 0, now - 30 * 60_000)
const backs: Record<string, { state: RenderState, at: number }> = {
  'back-idle': { state: { ...base, slide: null, timer: null }, at: now },
  'back-before': { state: { ...base, slide: null, timer: null, schedule: deck }, at: day(8, 50) },
  'back-chapter': { state: { ...base, slide: null, timer: null, schedule: deck, day: hooks }, at: day(9, 24) },
  'back-overrun': { state: { ...base, slide: null, timer: null, schedule: deck, day: enter(deck, EMPTY_DAY, 0, day(9, 0)) }, at: day(9, 50) },
  'back-long-title': { state: { ...base, slide: null, timer: null, schedule: deck, day: enter(deck, EMPTY_DAY, 2, day(10, 0)) }, at: day(10, 10) },
  'back-timer': { state: { ...base, slide: null, timer: timer(754_000), schedule: live, day: onTime }, at: now },
  'back-lab-next': { state: { ...base, slide: null, timer: lab(0, now - 5_000), schedule: live, day: onTime }, at: now },
  'back-time-up': { state: { ...base, slide: null, timer: timer(-5000), schedule: live, day: onTime }, at: now - (now % 1000) },
  'back-end': { state: { ...base, slide: null, timer: null, schedule: deck, day: enter(deck, EMPTY_DAY, 3, day(12, 30)) }, at: day(12, 40) },
}
for (const [name, { state, at }] of Object.entries(backs)) {
  await bar.DisplayClear({ application_name: APPLICATION })
  await bar.DisplayDraw({ application_name: APPLICATION, priority: 60, elements: renderBack(state, at, config).elements })
  await new Promise(resolve => setTimeout(resolve, 500))
  const px = await bar.DisplayScreenFrameGet({ display: 1 }, { dataType: 'binary', format: 'rgba' })
  png(px!, path.join(out, `${name}.png`), 160, 80, 4)
  console.log(name)
}
await bar.DisplayClear({ application_name: APPLICATION })
