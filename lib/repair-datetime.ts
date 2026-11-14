/**
 * Repair intake booking timestamps.
 * intakeDate is stored as a full ISO datetime in app_state + Prisma;
 * UI historically showed date-only — helpers keep date+time consistent.
 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Combine YYYY-MM-DD + HH:mm (local) into an ISO string for storage. */
export function combineLocalDateAndTime(date: string, time: string): string {
  const d = String(date || '').trim()
  const t = String(time || '').trim() || '00:00'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date().toISOString()
  const hhmm = /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : '00:00'
  const parsed = new Date(`${d}T${hhmm}:00`)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

/**
 * Ensure intakeDate is always a full ISO datetime for DB persistence.
 * Date-only YYYY-MM-DD values keep that calendar day (local midnight) —
 * replacing them with "now" used to stamp today's year onto a booked date
 * (REP-352227: 2091-04-28 / 2026-04-28 became "today" on the next save).
 * Empty / unparseable values still fall back to now.
 */
export function ensureRepairIntakeTimestamp(value: unknown, now = new Date()): string {
  if (typeof value === 'string') {
    const raw = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return combineLocalDateAndTime(raw, '00:00')
    }
    if (raw.includes('T')) {
      const d = new Date(raw)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }
  return now.toISOString()
}
