/**
 * Application timezone — all user-facing date/time formatting should use this
 * so timestamps are consistent regardless of the server's system timezone.
 *
 * The Contabo production server runs in Europe (UTC+1/+2), but the business
 * operates in Nairobi (UTC+3). Without an explicit timeZone, toLocaleString
 * uses the process timezone, producing timestamps 2 hours behind Kenya.
 *
 * Server-side: also set TZ=Africa/Nairobi in .env / PM2 config as a belt-
 * and-suspenders measure. Client-side: the browser already uses the user's
 * local timezone, but passing timeZone explicitly ensures SSR hydration
 * matches for Kenyan users.
 */
export const APP_TIMEZONE = 'Africa/Nairobi'

export const APP_LOCALE = 'en-KE'

export type DateFormatStyle = 'date' | 'datetime' | 'time'

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}

const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    const raw = typeof value === 'string' ? value : value.toISOString()
    const d = new Date(raw.includes('T') || raw.includes('Z') ? raw : `${raw}T00:00:00`)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString(APP_LOCALE, DATE_OPTS)
  } catch {
    return String(value)
  }
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    const raw = typeof value === 'string' ? value : value.toISOString()
    if (!raw) return ''
    const d = new Date(raw.includes('T') || raw.includes('Z') ? raw : `${raw}T00:00:00`)
    if (Number.isNaN(d.getTime())) return String(value)
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return d.toLocaleDateString(APP_LOCALE, DATE_OPTS)
    }
    return d.toLocaleString(APP_LOCALE, DATETIME_OPTS)
  } catch {
    return String(value)
  }
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  try {
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleTimeString(APP_LOCALE, TIME_OPTS)
  } catch {
    return String(value)
  }
}
