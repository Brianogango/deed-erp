/**
 * A date range for a list screen, as a named period or two dates.
 *
 * Every list that holds dated records wants the same thing — "this month",
 * "last quarter", "between these two days" — so the periods, the arithmetic
 * and the wording live here once instead of in each screen.
 *
 * Dates are plain YYYY-MM-DD and compared as strings, which is safe for that
 * format and keeps a record on the boundary day inside the range whatever
 * time it carries.
 */

export const DATE_RANGE_PRESETS = [
  'all',
  'today',
  'last_7',
  'last_30',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'custom',
] as const

export type DateRangePreset = typeof DATE_RANGE_PRESETS[number]

export interface DateRange {
  preset: DateRangePreset
  /** Only meaningful when preset is 'custom'. */
  from?: string
  to?: string
}

export const ALL_DATES: DateRange = { preset: 'all' }

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  all: 'Any date',
  today: 'Today',
  last_7: 'Last 7 days',
  last_30: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom range',
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day))

/** The first and last day a period covers, inclusive. Undefined means open-ended. */
export function resolveDateRange(range: DateRange, today = new Date()): { from?: string; to?: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const d = today.getUTCDate()
  switch (range.preset) {
    case 'today':
      return { from: iso(utc(y, m, d)), to: iso(utc(y, m, d)) }
    case 'last_7':
      return { from: iso(utc(y, m, d - 6)), to: iso(utc(y, m, d)) }
    case 'last_30':
      return { from: iso(utc(y, m, d - 29)), to: iso(utc(y, m, d)) }
    case 'this_month':
      return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) }
    case 'last_month':
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) }
    case 'this_quarter': {
      const q = Math.floor(m / 3) * 3
      return { from: iso(utc(y, q, 1)), to: iso(utc(y, q + 3, 0)) }
    }
    case 'this_year':
      return { from: iso(utc(y, 0, 1)), to: iso(utc(y, 11, 31)) }
    case 'custom':
      // A half-filled custom range still filters on the end it has.
      return { from: range.from || undefined, to: range.to || undefined }
    case 'all':
    default:
      return {}
  }
}

/** True when this range would leave the list untouched. */
export function isOpenRange(range: DateRange | null | undefined): boolean {
  if (!range || range.preset === 'all') return true
  const { from, to } = resolveDateRange(range)
  return !from && !to
}

export function isWithinRange(value: unknown, range: DateRange, today = new Date()): boolean {
  if (isOpenRange(range)) return true
  const day = String(value ?? '').slice(0, 10)
  // A record with no date cannot be shown to fall inside a period.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const { from, to } = resolveDateRange(range, today)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

export function filterByDateRange<T>(rows: T[], getDate: (row: T) => unknown, range: DateRange, today = new Date()): T[] {
  if (isOpenRange(range)) return rows
  return rows.filter(row => isWithinRange(getDate(row), range, today))
}

/** What the active-filter chip reads, e.g. "This month" or "1 Nov – 15 Nov 2026". */
export function describeDateRange(range: DateRange, today = new Date()): string {
  if (isOpenRange(range)) return DATE_RANGE_LABELS.all
  if (range.preset !== 'custom') return DATE_RANGE_LABELS[range.preset]
  const { from, to } = resolveDateRange(range, today)
  if (from && to) return `${from} – ${to}`
  if (from) return `From ${from}`
  return `Until ${to}`
}

/**
 * The period control a dated list hands to DataTable (or passes through to it).
 * `accessor` makes the table filter its own rows; leave it out to filter
 * server-side from `value`.
 */
export interface DateFilterConfig<T> {
  label: string
  value: DateRange
  onChange: (next: DateRange) => void
  accessor?: (row: T) => unknown
}
