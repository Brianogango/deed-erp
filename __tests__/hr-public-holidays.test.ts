import { afterEach, describe, expect, it } from 'vitest'
import { calcWorkingDays, isPublicHolidayIso, registerExtraPublicHolidays, builtInPublicHolidays } from '@/lib/leave-utils'

describe('extra public holidays', () => {
  afterEach(() => registerExtraPublicHolidays([]))

  it('treats HR-added dates as non-working days', () => {
    // Mon 16 Mar 2026 to Sat 21 Mar 2026 = 6 working days
    expect(calcWorkingDays('2026-03-16', '2026-03-21')).toBe(6)
    registerExtraPublicHolidays(['2026-03-20'])
    expect(isPublicHolidayIso('2026-03-20')).toBe(true)
    expect(calcWorkingDays('2026-03-16', '2026-03-21')).toBe(5)
  })

  it('replaces rather than accumulates, and ignores malformed dates', () => {
    registerExtraPublicHolidays(['2026-03-20', 'bad'])
    registerExtraPublicHolidays(['2026-03-19'])
    expect(isPublicHolidayIso('2026-03-20')).toBe(false)
    expect(isPublicHolidayIso('2026-03-19')).toBe(true)
  })

  it('lists the built-in holidays for a year', () => {
    expect(builtInPublicHolidays(2026)).toContain('2026-04-03')
    expect(builtInPublicHolidays(2026)).toContain('2026-12-25')
  })
})
