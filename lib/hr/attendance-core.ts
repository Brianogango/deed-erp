/**
 * Attendance rules, shared by the server and the screens (no server imports).
 *
 * A day counts only once it is approved: automatically when the clock-in came
 * from an office connection and was confirmed with the person's own Face ID /
 * fingerprint, otherwise by a supervisor. Its worth comes from the hours
 * between clock-in and clock-out: 6 hours or more is a full day, 3 to 6 a half
 * day, less than 3 nothing. Holidays and leave are not paid to daily-rate
 * staff, so only days actually worked count.
 */

export const FULL_DAY_HOURS = 6
export const HALF_DAY_HOURS = 3

export type AttendanceStatus = 'approved' | 'pending' | 'rejected'
export type PayBasis = 'monthly' | 'daily'

export type AttendanceDay = {
  id: string
  employeeId: string
  workDate: string // YYYY-MM-DD (Nairobi)
  clockIn: string | null // ISO
  clockOut: string | null
  inOffice: boolean
  outOffice: boolean | null
  inVerified: boolean
  outVerified: boolean | null
  status: AttendanceStatus
  note: string | null
  history: AttendanceHistoryEntry[]
}

export type AttendanceHistoryEntry = { at: string; by: string; action: string; reason?: string }

export type DayProblem = 'no_clock_out' | 'outside_office' | 'no_fingerprint' | 'short_day'

const round2 = (n: number) => Math.round(n * 100) / 100

export function hoursBetween(clockIn: string | null, clockOut: string | null): number {
  if (!clockIn || !clockOut) return 0
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  return ms > 0 ? round2(ms / 3_600_000) : 0
}

/** 1, 0.5 or 0 for the hours worked. */
export function dayValueForHours(hours: number): number {
  if (hours >= FULL_DAY_HOURS) return 1
  if (hours >= HALF_DAY_HOURS) return 0.5
  return 0
}

/** What a day is worth for pay: nothing until it is approved and has a clock-out. */
export function payableValue(day: Pick<AttendanceDay, 'status' | 'clockIn' | 'clockOut'>): number {
  if (day.status !== 'approved') return 0
  return dayValueForHours(hoursBetween(day.clockIn, day.clockOut))
}

export function dayProblems(day: Pick<AttendanceDay, 'clockIn' | 'clockOut' | 'inOffice' | 'outOffice' | 'inVerified'>, today: string, workDate: string): DayProblem[] {
  const out: DayProblem[] = []
  if (day.clockIn && !day.clockOut && workDate < today) out.push('no_clock_out')
  if (!day.inOffice || day.outOffice === false) out.push('outside_office')
  if (!day.inVerified) out.push('no_fingerprint')
  if (day.clockIn && day.clockOut && hoursBetween(day.clockIn, day.clockOut) < HALF_DAY_HOURS) out.push('short_day')
  return out
}

export const PROBLEM_TEXT: Record<DayProblem, string> = {
  no_clock_out: 'No clock-out',
  outside_office: 'Not on the office connection',
  no_fingerprint: 'No Face ID / fingerprint',
  short_day: `Under ${HALF_DAY_HOURS} hours`,
}

/** Days to pay in a month: the sum of approved days' worth. */
export function payableDays(days: Pick<AttendanceDay, 'status' | 'clockIn' | 'clockOut'>[]): number {
  return round2(days.reduce((s, d) => s + payableValue(d), 0))
}

export function dailyPay(days: number, rate: number): number {
  return round2(Math.max(0, days) * Math.max(0, rate))
}

// ── Office connections ─────────────────────────────────────────────────────

/** "::ffff:1.2.3.4" → "1.2.3.4"; lower-case IPv6. */
export function normalizeIp(ip: string | null | undefined): string {
  const v = String(ip ?? '').trim().toLowerCase()
  return v.startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v
}

function expandIpv6(ip: string): string[] | null {
  if (!ip.includes(':')) return null
  const [head, tail = ''] = ip.split('::')
  const a = head ? head.split(':') : []
  const b = ip.includes('::') ? (tail ? tail.split(':') : []) : []
  const fill = ip.includes('::') ? 8 - a.length - b.length : 0
  const parts = [...a, ...Array(Math.max(0, fill)).fill('0'), ...b]
  if (parts.length !== 8 || parts.some(p => !/^[0-9a-f]{1,4}$/.test(p))) return null
  return parts.map(p => p.replace(/^0+(?=.)/, ''))
}

/**
 * What identifies an office connection. An IPv4 address is shared by every
 * device behind the office router, so it is kept whole. With IPv6 each device
 * gets its own address inside the office's network block, so the first half
 * (the /64 the router hands out) is what they have in common.
 */
export function networkKey(ip: string | null | undefined): string | null {
  const v = normalizeIp(ip)
  if (!v || v === 'unknown') return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v
  const parts = expandIpv6(v)
  return parts ? `${parts.slice(0, 4).join(':')}::/64` : null
}

/** Office connections are stored by their networkKey. */
export function isOfficeIp(ip: string | null | undefined, networks: { ip: string }[]): boolean {
  const key = networkKey(ip)
  return !!key && networks.some(n => n.ip === key)
}

/** Today's date in Nairobi, YYYY-MM-DD. */
export function nairobiDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(at)
}

/** "2026-11" → first and last dates. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` }
}
