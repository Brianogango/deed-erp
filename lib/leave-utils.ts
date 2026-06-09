// ── Leave Utilities — Deed Technologies Leave Policy (v1.0 Jan 2026) ─────────

export type StoreLeaveType =
  | 'annual'          // 13 discretionary days
  | 'sick'            // 7 full pay + 7 half pay (Employment Act)
  | 'maternity'       // 90 calendar days (Employment Act)
  | 'paternity'       // 14 calendar days (Employment Act)
  | 'compassionate'   // 5 working days
  | 'study'           // 5 working days
  | 'unpaid'          // no fixed entitlement
  | 'december_closure' // 8 days — system-managed, not employee-selectable

// Types an employee can request themselves (december_closure is system-only)
export const EMPLOYEE_LEAVE_TYPES: StoreLeaveType[] = [
  'annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid',
]

// Policy entitlements per type per year
export const LEAVE_ENTITLEMENTS: Record<StoreLeaveType, number> = {
  annual:            13,
  sick:              14,   // 7 full pay + 7 half pay per Employment Act
  maternity:         90,   // calendar days
  paternity:         14,   // calendar days
  compassionate:      5,
  study:              5,
  unpaid:             0,   // unlimited — no fixed entitlement
  december_closure:   8,   // max; actual days computed per year (excl. PH)
}

// Types that use calendar days (not working days)
export const CALENDAR_DAY_TYPES: StoreLeaveType[] = ['maternity', 'paternity']

// Types exempt from advance notice requirements (emergency/medical)
export const NOTICE_EXEMPT_TYPES: StoreLeaveType[] = [
  'sick', 'compassionate', 'maternity', 'paternity',
]

// Notice period thresholds (policy section 4.1)
export const NOTICE_THRESHOLD_DAYS = 3   // ≤3 days = short; >3 days = long
export const NOTICE_SHORT_DAYS     = 5   // working days required for short leave
export const NOTICE_LONG_DAYS      = 14  // working days required for long leave

export const LEAVE_LABELS: Record<StoreLeaveType, string> = {
  annual:           'Annual Leave',
  sick:             'Sick Leave',
  maternity:        'Maternity Leave',
  paternity:        'Paternity Leave',
  compassionate:    'Compassionate / Bereavement',
  study:            'Study / Exam Leave',
  unpaid:           'Unpaid Leave',
  december_closure: 'December Closure',
}

export const LEAVE_COLORS: Record<StoreLeaveType, string> = {
  annual:           '#10B981',
  sick:             '#EF4444',
  maternity:        '#8B5CF6',
  paternity:        '#3B82F6',
  compassionate:    '#F97316',
  study:            '#0EA5E9',
  unpaid:           '#6B7280',
  december_closure: '#F59E0B',
}

// ── Kenyan Public Holidays ────────────────────────────────────────────────────

// Fixed holidays (MM-DD)
const KE_FIXED: string[] = [
  '01-01', // New Year's Day
  '05-01', // Labour Day
  '06-01', // Madaraka Day
  '10-10', // Huduma Day
  '10-20', // Mashujaa Day
  '12-12', // Jamhuri Day
  '12-25', // Christmas Day
  '12-26', // Boxing Day
]

// Easter variable holidays (Good Friday + Easter Monday) keyed by year
const KE_EASTER: Record<number, [string, string]> = {
  2025: ['04-18', '04-21'],
  2026: ['04-03', '04-06'],
  2027: ['03-26', '03-29'],
  2028: ['04-14', '04-17'],
  2029: ['03-30', '04-02'],
  2030: ['04-19', '04-22'],
}

export function isKenyaPublicHoliday(date: Date): boolean {
  const mm   = String(date.getMonth() + 1).padStart(2, '0')
  const dd   = String(date.getDate()).padStart(2, '0')
  const mmdd = `${mm}-${dd}`
  const year = date.getFullYear()
  if (KE_FIXED.includes(mmdd)) return true
  const easter = KE_EASTER[year]
  return !!easter && easter.includes(mmdd)
}

// ── Day calculators ───────────────────────────────────────────────────────────

/**
 * Count working days (Mon–Fri, excluding Kenyan public holidays)
 * between start and end inclusive.
 */
export function calcWorkingDays(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  if (e < s) return 0
  let days = 0
  const cur = new Date(s)
  while (cur <= e) {
    const d = cur.getDay()
    if (d !== 0 && d !== 6 && !isKenyaPublicHoliday(cur)) days++
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

/**
 * Count calendar days between start and end inclusive (for maternity/paternity).
 */
export function calcCalendarDays(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  if (e < s) return 0
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
}

/**
 * Calculate the number of working days of advance notice given a start date.
 * Returns the number of working days from today up to (but not including) startDate.
 */
export function noticeDaysGiven(startDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(startDate + 'T00:00:00')
  if (start <= today) return 0
  // Working days from today to startDate - 1
  const dayBefore = new Date(start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  return calcWorkingDays(
    today.toISOString().slice(0, 10),
    dayBefore.toISOString().slice(0, 10),
  )
}

/**
 * Required notice in working days for a leave request of `days` length.
 * Returns 0 for notice-exempt types.
 */
export function requiredNotice(leaveType: StoreLeaveType, days: number): number {
  if (NOTICE_EXEMPT_TYPES.includes(leaveType)) return 0
  return days <= NOTICE_THRESHOLD_DAYS ? NOTICE_SHORT_DAYS : NOTICE_LONG_DAYS
}

/**
 * Compute actual working days in the December closure period for a given year,
 * automatically excluding weekends and public holidays.
 */
export function decemberClosureDays(year: number): number {
  return calcWorkingDays(`${year}-12-23`, `${year + 1}-01-02`)
}
