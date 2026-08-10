import { describe, it, expect } from 'vitest'
import {
  calcWorkingDays,
  calcCalendarDays,
  leaveDaysForRange,
  noticeDaysGiven,
  requiredNotice,
  formatLocalDate,
  remainingBalance,
  decemberClosureDays,
} from '@/lib/leave-utils'

describe('calcWorkingDays (Mon–Saturday)', () => {
  it('counts Saturday as a working day and skips Sunday', () => {
    // 2026-08-01 Sat → 2026-08-02 Sun = 1 working day
    expect(calcWorkingDays('2026-08-01', '2026-08-02')).toBe(1)
    // Sunday only
    expect(calcWorkingDays('2026-08-02', '2026-08-02')).toBe(0)
    // Sat only
    expect(calcWorkingDays('2026-08-01', '2026-08-01')).toBe(1)
  })

  it('counts Mon–Sat as 6 working days', () => {
    // Mon 3 Aug → Sat 8 Aug 2026
    expect(calcWorkingDays('2026-08-03', '2026-08-08')).toBe(6)
  })

  it('counts Mon–Fri as 5 working days (Saturday not in range)', () => {
    expect(calcWorkingDays('2026-08-03', '2026-08-07')).toBe(5)
  })

  it('excludes Kenyan public holidays', () => {
    // Labour Day 2026-05-01 is a Friday — Mon 27 Apr → Fri 1 May = 4 working days
    expect(calcWorkingDays('2026-04-27', '2026-05-01')).toBe(4)
  })
})

describe('calcCalendarDays', () => {
  it('counts inclusive calendar days', () => {
    expect(calcCalendarDays('2026-08-01', '2026-08-14')).toBe(14)
  })
})

describe('leaveDaysForRange', () => {
  it('uses calendar days for maternity/paternity and working days otherwise', () => {
    expect(leaveDaysForRange('maternity', '2026-08-01', '2026-08-02')).toBe(2)
    expect(leaveDaysForRange('annual', '2026-08-01', '2026-08-02')).toBe(1)
  })
})

describe('formatLocalDate / noticeDaysGiven', () => {
  it('formats local calendar days without UTC shift', () => {
    const d = new Date(2026, 7, 1, 0, 0, 0, 0) // 1 Aug 2026 local midnight
    expect(formatLocalDate(d)).toBe('2026-08-01')
  })

  it('counts notice working days from today through day before start (Mon–Sat)', () => {
    // Today Wed 1 Jul 2026; start Mon 6 Jul → notice window Wed 1–Sun 5 Jul
    // Working days: Wed 1, Thu 2, Fri 3, Sat 4 = 4 (Sunday excluded)
    const today = new Date(2026, 6, 1, 9, 0, 0) // 1 Jul 2026
    expect(noticeDaysGiven('2026-07-06', today)).toBe(4)
  })

  it('does not inflate notice via toISOString UTC shift', () => {
    // Same local day in the morning — notice for a start 6 working days out
    // must equal the true Mon–Sat count, not +1 from UTC.
    const today = new Date(2026, 6, 1, 0, 30, 0) // 1 Jul 2026 00:30 local
    // Start 2026-07-08 (Wed): notice window Jul 1–7 = Wed–Tue
    // Working: 1W 2Th 3F 4Sa (skip 5Su) 6M 7Tu = 6
    expect(noticeDaysGiven('2026-07-08', today)).toBe(6)
  })

  it('returns 0 when start is today or in the past', () => {
    const today = new Date(2026, 6, 1, 12, 0, 0)
    expect(noticeDaysGiven('2026-07-01', today)).toBe(0)
    expect(noticeDaysGiven('2026-06-30', today)).toBe(0)
  })
})

describe('requiredNotice', () => {
  it('requires 3 working days for short leave and 14 for long', () => {
    expect(requiredNotice('annual', 3)).toBe(3)
    expect(requiredNotice('annual', 1)).toBe(3)
    expect(requiredNotice('annual', 4)).toBe(14)
    expect(requiredNotice('sick', 10)).toBe(0)
  })
})

describe('remainingBalance', () => {
  it('computes entitlement + carry − used − pending', () => {
    expect(remainingBalance({ entitlement: 13, carryForward: 2, used: 10, pending: 3 })).toBe(2)
    expect(remainingBalance({ entitlement: 13, carryForward: 0, used: 13, pending: 0 })).toBe(0)
  })
})

describe('decemberClosureDays', () => {
  it('counts Mon–Sat working days in the closure window', () => {
    // 23 Dec 2026 Wed → 2 Jan 2027 Sat, excl Sundays + Christmas/Boxing/NY
    // Should be > 0 and include Saturdays where applicable
    expect(decemberClosureDays(2026)).toBeGreaterThan(0)
    expect(decemberClosureDays(2026)).toBe(calcWorkingDays('2026-12-23', '2027-01-02'))
  })
})
