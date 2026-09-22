/* Draws every state on a real bar and saves a screenshot of each:
     npm run preview -- <folder>
   Needs BUSYBAR_ADDR (and BUSYBAR_PASSWORD over Wi-Fi) in `.env.local`. It
   draws as its own application at a higher priority, then clears. */
import type { RenderState } from './render.ts'
import type { Timer } from './timer.ts'
import type { SlideInfo } from './types.ts'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { BusyBar } from '@busy-app/busy-lib'
import { resolveConfig } from './config.ts'
import { rect } from './draw.ts'
import { render } from './render.ts'

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

const states: Record<string, RenderState> = {
  'chapter': { slide: slide({}), timer: null },
  'chapter-accents': { slide: slide({ chapter: 'Réseau & sécurité', chapterNo: 2 }), timer: null },
  'section': { slide: slide({ chapter: null, progress: null, title: 'Part 1' }), timer: null },
  'break': { slide: slide({ screen: 'break', until: '10:45' }), timer: null },
  'welcome': { slide: slide({ screen: 'welcome' }), timer: null },
  'questions': { slide: slide({ screen: 'questions' }), timer: null },
  'logo': { slide: slide({ screen: 'box' }), timer: null },
  'activity': { slide: slide({ activity: 'Workshop 1', timer: ['15m'] }), timer: null },
  'timer-green': { slide: null, timer: timer(754_000) },
  'timer-short-label': { slide: null, timer: { ...timer(754_000), label: 'Quiz' } },
  'timer-orange': { slide: null, timer: timer(150_000) },
  'timer-red': { slide: null, timer: timer(42_000) },
  'timer-paused': { slide: null, timer: timer(754_000, false) },
  'time-up': { slide: null, timer: timer(-5000) },
  'break-ready': { slide: slide({ screen: 'break', timer: ['15m'] }), timer: null },
  'break-running': { slide: slide({ screen: 'break', timer: ['15m'] }), timer: { ...timer(754_000), label: 'Break', style: 'break' } },
  'break-last-minute': { slide: null, timer: { ...timer(42_000), label: 'Break', style: 'break' } },
  'break-over': { slide: null, timer: { ...timer(-5000), label: 'Break', style: 'break' } },
  'lab-ready': { slide: slide({ activity: 'Lab', timer: ['5m Reading', '10m Coding', '5m Sharing'] }), timer: null },
  'lab-coding': { slide: null, timer: lab(1, now + 300_000) },
  'lab-next': { slide: null, timer: lab(0, now - 5_000) },
  'lab-next-led': { slide: null, timer: lab(0, now - 40_000) },
}

/* "Time's up" and "Break's over!" captured while lit. */
const at = (name: string) => name === 'time-up' || name === 'break-over' ? now - (now % 1000) : now

function png(px: Uint8Array, file: string) {
  const W = 72
  const H = 16
  const S = 10
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
await bar.DisplayClear({ application_name: APPLICATION })
