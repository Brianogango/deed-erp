/**
 * P1-DATA-001 — targeted guards for corrupt refs and implausible dates.
 *
 * Sequence numbers must be finite positive integers (never produce "RFD/0NaN").
 * Repair intake dates must fall between a business minimum and today + grace.
 */

/** Business earliest plausible document/intake date. */
export const REPAIR_DATE_MIN = '2015-01-01'

/** How far past "today" a repair intake date may be set. */
export const REPAIR_DATE_MAX_YEARS_AHEAD = 2

export function repairDateMaxIso(now: Date = new Date()): string {
  const d = new Date(now.getTime())
  d.setFullYear(d.getFullYear() + REPAIR_DATE_MAX_YEARS_AHEAD)
  return d.toISOString().slice(0, 10)
}

/** Normalize to YYYY-MM-DD when parseable; otherwise null. */
export function toDateOnly(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Returns an error message when `value` is present and outside bounds.
 * Empty / missing values are allowed (caller decides requiredness).
 */
export function repairDateBoundsError(
  value: unknown,
  fieldName = 'intakeDate',
  now: Date = new Date(),
): string | null {
  if (value == null || String(value).trim() === '') return null
  const day = toDateOnly(value)
  if (!day) return `${fieldName} is not a valid date`
  const min = REPAIR_DATE_MIN
  const max = repairDateMaxIso(now)
  if (day < min) return `${fieldName} must be on or after ${min}`
  if (day > max) return `${fieldName} must be on or before ${max}`
  return null
}

/** Validate intakeDate and legacy `date` on a repair payload. */
export function repairDatesWriteError(
  next: { intakeDate?: unknown; date?: unknown },
  now: Date = new Date(),
): string | null {
  return (
    repairDateBoundsError(next.intakeDate, 'intakeDate', now) ||
    repairDateBoundsError(next.date, 'date', now)
  )
}

/**
 * Guard for sequence counters. Throws when the next value is not a finite
 * positive integer — callers must not persist refs containing "NaN".
 */
export function assertFiniteSequenceNext(next: number, label = 'sequence'): number {
  if (!Number.isFinite(next) || !Number.isInteger(next) || next < 1) {
    throw new Error(`Invalid ${label}: expected a finite positive integer, got ${String(next)}`)
  }
  return next
}

/** True when a document ref looks corrupt (e.g. RFD/0NaN). */
export function isCorruptDocRef(ref: unknown): boolean {
  const s = String(ref ?? '')
  return /NaN/i.test(s) || !s.trim()
}
