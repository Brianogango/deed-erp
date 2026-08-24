export type TargetDirection = 'min' | 'max'
export type TargetPeriod = 'monthly' | 'weekly' | 'quarterly'

const DAY_MS = 86_400_000
const NAIROBI_TIME_ZONE = 'Africa/Nairobi'

function formatZonedDate(date: Date, timeZone = NAIROBI_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Nairobi calendar key for an instant or date-only value. */
export function nairobiDateKey(value: string | Date = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : formatZonedDate(date)
}

/** Preserve the calendar day selected in a date input, including legacy midnight ISO values. */
export function storedDateKey(value?: string | null): string {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

export function resolveHoldoverStatus(
  expectedReturnDate: string,
  returnedDate?: string | null,
  now: Date = new Date(),
): 'active' | 'overdue' | 'returned' {
  if (returnedDate) return 'returned'
  const expected = storedDateKey(expectedReturnDate)
  const today = nairobiDateKey(now)
  return expected && today && expected < today ? 'overdue' : 'active'
}

export function holdoverLoanDays(
  issuedDate: string,
  end: string | Date = new Date(),
): number {
  const startKey = storedDateKey(issuedDate) || nairobiDateKey(issuedDate)
  const endKey = typeof end === 'string'
    ? storedDateKey(end) || nairobiDateKey(end)
    : nairobiDateKey(end)
  if (!startKey || !endKey) return 0
  return Math.max(0, Math.ceil(dayNumber(endKey) - dayNumber(startKey)))
}

export function holdoverOverdueDays(
  expectedReturnDate: string,
  end: string | Date = new Date(),
): number {
  const expected = storedDateKey(expectedReturnDate)
  const endKey = typeof end === 'string'
    ? storedDateKey(end) || nairobiDateKey(end)
    : nairobiDateKey(end)
  if (!expected || !endKey) return 0
  return Math.max(0, Math.ceil(dayNumber(endKey) - dayNumber(expected)))
}

export function currentTargetPeriodKey(
  period: TargetPeriod,
  now: Date = new Date(),
): string {
  const [year, month, day] = nairobiDateKey(now).split('-').map(Number)
  if (period === 'monthly') return `${year}-${String(month).padStart(2, '0')}`
  if (period === 'quarterly') return `${year}-Q${Math.ceil(month / 3)}`

  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - first.getTime()) / DAY_MS + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function targetPeriodBounds(
  key: string,
  period: TargetPeriod,
): { start: string; end: string } {
  if (period === 'weekly') {
    const match = key.match(/^(\d{4})-W(\d{2})$/)
    if (!match) return { start: '', end: '' }
    const year = Number(match[1])
    const week = Number(match[2])
    const jan4 = new Date(Date.UTC(year, 0, 4))
    const monday = new Date(
      jan4.getTime() +
      (week - 1) * 7 * DAY_MS -
      ((jan4.getUTCDay() + 6) % 7) * DAY_MS,
    )
    return {
      start: utcDateKey(monday),
      end: utcDateKey(new Date(monday.getTime() + 6 * DAY_MS)),
    }
  }

  if (period === 'quarterly') {
    const match = key.match(/^(\d{4})-Q([1-4])$/)
    if (!match) return { start: '', end: '' }
    const year = Number(match[1])
    const startMonth = (Number(match[2]) - 1) * 3
    return {
      start: utcDateKey(new Date(Date.UTC(year, startMonth, 1))),
      end: utcDateKey(new Date(Date.UTC(year, startMonth + 3, 0))),
    }
  }

  const match = key.match(/^(\d{4})-(\d{2})$/)
  if (!match) return { start: '', end: '' }
  const year = Number(match[1])
  const month = Number(match[2])
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: utcDateKey(new Date(Date.UTC(year, month, 0))),
  }
}

export function previousTargetPeriodKeys(
  period: TargetPeriod,
  count = 5,
  now: Date = new Date(),
): string[] {
  const [year, month, day] = nairobiDateKey(now).split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day))

  return Array.from({ length: count }, (_, index) => {
    const distance = index + 1
    if (period === 'weekly') {
      return currentTargetPeriodKey('weekly', new Date(anchor.getTime() - distance * 7 * DAY_MS))
    }
    if (period === 'monthly') {
      const date = new Date(Date.UTC(year, month - 1 - distance, 1))
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    }
    const currentQuarterIndex = year * 4 + Math.floor((month - 1) / 3)
    const targetIndex = currentQuarterIndex - distance
    const targetYear = Math.floor(targetIndex / 4)
    return `${targetYear}-Q${(targetIndex % 4 + 4) % 4 + 1}`
  })
}

export function targetMetricProgress(
  actual: number,
  target: number,
  direction: TargetDirection,
): number {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return 0
  if (direction === 'max') {
    if (actual <= target) return 100
    return Math.max(0, Math.min(100, Math.round((target / actual) * 100)))
  }
  return Math.max(0, Math.min(100, Math.round((actual / target) * 100)))
}

export function targetOverallScore(
  metrics: Array<{ actual: number; target: number; direction: TargetDirection }>,
): number {
  if (metrics.length === 0) return 0
  const total = metrics.reduce(
    (sum, metric) => sum + targetMetricProgress(metric.actual, metric.target, metric.direction),
    0,
  )
  return Math.round(total / metrics.length)
}
