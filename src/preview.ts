/* Draws every state on a real bar and saves a screenshot of each:
     npm run preview -- <folder>
   Needs BUSYBAR_ADDR (and BUSYBAR_PASSWORD over Wi-Fi) in `.env.local`. It
   draws as its own application at a higher priority, then clears. */
import type { RenderState } from './render.ts'
import type { Timer } from './timer.ts'
import type { Element, SlideInfo } from './types.ts'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { BusyBar } from '@busy-app/busy-lib'
import { resolveConfig } from './config.ts'
import { rect } from './draw.ts'
import { render } from './render.ts'
import { EMPTY_DAY } from './schedule.ts'

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

/* Back display probes (spike, spec §6): fonts, scrolling, greys, accents,
   a mixed front + back draw, and clearing back elements by id. */
const back = <T extends Record<string, unknown>>(e: T) => ({ ...e, display: 'back' as const })
const fonts = ['tiny', 'small', 'normal', 'condensed', 'bold', 'large', 'extra_large', 'global'] as const
const probes: Record<string, Element[]> = {
  'back-fonts': fonts.map((font, i) => back({ id: `f-${font}`, type: 'text' as const, text: `${font} 10:52`, font, color: '#FFFFFFFF', x: 2 + (i % 2) * 80, y: 2 + Math.floor(i / 2) * 19, align: 'top_left' as const })),
  'back-greys': ['#FFFFFFFF', '#C0C0C0FF', '#8A8A8AFF', '#404040FF', '#202020FF'].map((color, i) => back({ id: `g${i}`, type: 'rectangle' as const, x: 4 + i * 30, y: 10, width: 24, height: 40, fill: 'solid' as const, fill_colors: [color], border_width: 0 })),
  'back-scroll': [
    back({ id: 'scroll', type: 'text' as const, text: 'Référencer du code et sécuriser le réseau', font: 'global' as const, color: '#FFFFFFFF', x: 4, y: 20, align: 'top_left' as const, width: 100, scroll_rate: 900, scroll_start_delay: 500, scroll_repeat_delay: 2000 }),
    back({ id: 'accents', type: 'text' as const, text: 'Éléphant à l\'école', font: 'global' as const, color: '#FFFFFFFF', x: 4, y: 50, align: 'top_left' as const }),
  ],
  'back-mixed': [
    { id: 'front-title', type: 'text', text: 'Front', font: 'global', color: '#FFFFFFFF', x: 36, y: 2, align: 'top_mid' },
    back({ id: 'back-title', type: 'text' as const, text: 'Back', font: 'extra_large' as const, color: '#FFFFFFFF', x: 80, y: 30, align: 'top_mid' as const }),
    back({ id: 'back-box', type: 'rectangle' as const, x: 10, y: 10, width: 20, height: 20, fill: 'solid' as const, fill_colors: ['#8A8A8AFF'], border_width: 0 }),
  ],
}
for (const [name, elements] of Object.entries(probes)) {
  await bar.DisplayClear({ application_name: APPLICATION })
  await bar.DisplayDraw({ application_name: APPLICATION, priority: 60, elements })
  await new Promise(resolve => setTimeout(resolve, name === 'back-scroll' ? 3000 : 500))
  const px = await bar.DisplayScreenFrameGet({ display: 1 }, { dataType: 'binary', format: 'rgba' })
  png(px!, path.join(out, `${name}.png`), 160, 80, 4)
  console.log(name)
  if (name === 'back-mixed') {
    /* Does clearing by id reach back elements? Both screens captured after. */
    await bar.DisplayClear({ application_name: APPLICATION, element_ids: ['back-box'] })
    await new Promise(resolve => setTimeout(resolve, 500))
    png((await bar.DisplayScreenFrameGet({ display: 1 }, { dataType: 'binary', format: 'rgba' }))!, path.join(out, 'back-mixed-cleared.png'), 160, 80, 4)
    png((await bar.DisplayScreenFrameGet({ display: 0 }, { dataType: 'binary', format: 'rgba' }))!, path.join(out, 'front-mixed.png'))
    console.log('back-mixed-cleared')
  }
}
await bar.DisplayClear({ application_name: APPLICATION })
