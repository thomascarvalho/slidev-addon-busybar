/* What the browser posts to `/__busy/*`, read and checked: the browser is the
   trust boundary, so every field is validated and capped here. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TimerAction } from './timer.ts'
import type { Schedule, SlideInfo, Step } from './types.ts'

/* A schedule is a few dozen steps; a slide a few lines. */
const MAX_BODY = 65_536
const MAX_PHASES = 10
const MAX_STEPS = 200
const MAX_WARNINGS = 20

export function reply(res: ServerResponse, status: number) {
  res.statusCode = status
  res.end()
}

/** The request's JSON object, or `null` when it is not one (or too big). */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY)
      return null
  }
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  }
  catch {
    return null
  }
}

function str(value: unknown): string | null {
  if (typeof value === 'number')
    return String(value)
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

function strs(value: unknown, max: number): string[] | null {
  const list = (Array.isArray(value) ? value : [value]).map(str).filter((s): s is string => s !== null).slice(0, max)
  return list.length ? list : null
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** Minutes since midnight, or `null` for none; `undefined` when unreadable. */
function minutes(value: unknown): number | null | undefined {
  if (value === null || value === undefined)
    return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440 ? value : undefined
}

export function isTimerAction(value: unknown): value is TimerAction {
  return value === 'toggle' || value === 'add' || value === 'skip' || value === 'cancel'
}

export function parseSlide(body: Record<string, unknown>): SlideInfo | null {
  const no = int(body.no)
  if (no === null)
    return null
  const p = body.progress as { index?: unknown, count?: unknown } | null
  const index = int(p?.index)
  const count = int(p?.count)
  return {
    no,
    title: str(body.title),
    chapter: str(body.chapter),
    chapterNo: int(body.chapterNo) || null,
    progress: index && count && index <= count ? { index, count } : null,
    activity: str(body.activity),
    timer: strs(body.timer, MAX_PHASES),
    screen: str(body.screen),
    until: str(body.until),
    text: str(body.text),
    sound: body.sound === false ? false : str(body.sound),
  }
}

function parseStep(value: unknown): Step | null {
  const v = value as Record<string, unknown> | null
  const from = int(v?.from)
  const kind = str(v?.kind)
  const durationMs = int(v?.durationMs)
  const at = minutes(v?.at)
  if (!v || from === null || from < 1 || kind === null || durationMs === null || at === undefined)
    return null
  return { from, kind, label: v.label === null ? null : str(v.label), durationMs, at }
}

export function parseSchedule(body: Record<string, unknown>): Schedule | null {
  const start = minutes(body.start)
  const end = minutes(body.end)
  if (start === undefined || end === undefined || !Array.isArray(body.steps))
    return null
  const steps = body.steps.slice(0, MAX_STEPS).map(parseStep)
  if (steps.some(s => s === null))
    return null
  const warnings = strs(body.warnings, MAX_WARNINGS) ?? []
  return { start, end, steps: steps as Step[], warnings }
}
