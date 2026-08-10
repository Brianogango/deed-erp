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

// ── Gender-restricted types ───────────────────────────────────────────────────
// Maternity is female-only; paternity is male-only (two weeks per Employment Act).
// An unknown/blank gender is not restricted, so incomplete records never block leave.
export type EmployeeGender = 'male' | 'female' | '' | null | undefined

export function isLeaveTypeAllowedForGender(type: StoreLeaveType, gender: EmployeeGender): boolean {
  const g = String(gender ?? '').toLowerCase()
  if (type === 'maternity') return g !== 'male'
  if (type === 'paternity') return g !== 'female'
  return true
}

/** Employee-selectable leave types, filtered by gender. */
export function employeeLeaveTypesFor(gender: EmployeeGender): StoreLeaveType[] {
  return EMPLOYEE_LEAVE_TYPES.filter(t => isLeaveTypeAllowedForGender(t, gender))
}

/** Policy entitlement for a type, honouring gender restrictions (0 when not applicable). */
export function entitlementFor(type: StoreLeaveType, gender: EmployeeGender): number {
  return isLeaveTypeAllowedForGender(type, gender) ? (LEAVE_ENTITLEMENTS[type] ?? 0) : 0
}

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
export const NOTICE_SHORT_DAYS     = 3   // working days required for short leave (≤3 days)
export const NOTICE_LONG_DAYS      = 14  // working days required for long leave (>3 days)

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

/**
 * Format a Date as YYYY-MM-DD using the environment's local calendar day.
 * Do NOT use `toISOString().slice(0,10)` for local midnights — in UTC+3
 * (Africa/Nairobi) that shifts the date back by one day.
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Deed working week: Monday–Saturday. Only Sunday is a rest day. */
export function isWorkingDay(date: Date): boolean {
  return date.getDay() !== 0 && !isKenyaPublicHoliday(date)
}

// ── Day calculators ───────────────────────────────────────────────────────────

/**
 * Count working days (Mon–Saturday, excluding Kenyan public holidays)
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
    if (isWorkingDay(cur)) days++
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

/** Days charged for a leave type over a date range (never trust a client-sent count). */
export function leaveDaysForRange(leaveType: StoreLeaveType, start: string, end: string): number {
  return CALENDAR_DAY_TYPES.includes(leaveType)
    ? calcCalendarDays(start, end)
    : calcWorkingDays(start, end)
}

/** Remaining days available: entitlement + carryForward − used − pending. */
export function remainingBalance(bal: {
  entitlement: number
  carryForward: number
  used: number
  pending: number
}): number {
  return bal.entitlement + bal.carryForward - bal.used - bal.pending
}

/**
 * Calculate the number of working days of advance notice given a start date.
 * Returns the number of working days from today up to (but not including) startDate.
 */
export function noticeDaysGiven(startDate: string, today: Date = new Date()): number {
  const startOfToday = new Date(today)
  startOfToday.setHours(0, 0, 0, 0)
  const start = new Date(String(startDate).slice(0, 10) + 'T00:00:00')
  if (start <= startOfToday) return 0
  // Working days from today to startDate - 1
  const dayBefore = new Date(start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  return calcWorkingDays(
    formatLocalDate(startOfToday),
    formatLocalDate(dayBefore),
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
 * automatically excluding Sundays and public holidays (Mon–Sat working week).
 */
export function decemberClosureDays(year: number): number {
  return calcWorkingDays(`${year}-12-23`, `${year + 1}-01-02`)
}
