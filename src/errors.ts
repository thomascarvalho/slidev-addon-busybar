/* Errors, in words. */

/** The message of whatever was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A bar error, in words a trainer can act on. */
export function describeBarError(error: unknown): string {
  const e = error as { status?: number, name?: string, message?: string }
  if (e.status === 409)
    return 'BUSY Bar refused to draw (409). Set the switch on the bar to APPS, and stop the BUSY timer if one runs.'
  if (e.status === 400)
    return `BUSY Bar rejected a request (400): ${e.message ?? 'no detail'}.`
  if (e.status === 403)
    return 'BUSY Bar denied access (403). Check BUSYBAR_PASSWORD in .env.local.'
  if (e.name === 'TimeoutError')
    return 'BUSY Bar not responding. The talk goes on without it; retrying every 5 s.'
  const code = (error as { cause?: { code?: string } }).cause?.code
  if (code === 'EHOSTUNREACH')
    return 'BUSY Bar unreachable (EHOSTUNREACH). On macOS, allow your terminal in System Settings → Privacy & Security → Local Network. The talk goes on without it; retrying every 5 s.'
  return `BUSY Bar unreachable (${e.message ?? String(error)}). The talk goes on without it; retrying every 5 s.`
}
