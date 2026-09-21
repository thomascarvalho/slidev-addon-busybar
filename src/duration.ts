/** `90s`, `15m`, `1h30m`, `1h 30m 15s` → milliseconds; `null` if unreadable. */
export function parseDuration(value: string): number | null {
  const match = /^\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?\s*$/i.exec(value)
  if (!match || !(match[1] || match[2] || match[3]))
    return null
  const [, h = '0', m = '0', s = '0'] = match
  const ms = ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000
  return ms > 0 ? ms : null
}

/** 754 000 → `12:34`, 3 723 000 → `1:02:03`. Rounded up to the second. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
