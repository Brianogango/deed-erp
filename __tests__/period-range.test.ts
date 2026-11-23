import { describe, expect, it } from 'vitest'
import { periodOf, periodRange } from '@/lib/finance/period-range'

// Friday 20 Nov 2026, 01:30 local — early morning, when UTC is still the 19th in Nairobi.
const now = new Date(2026, 10, 20, 1, 30)

describe('report periods', () => {
  it('are local calendar dates', () => {
    expect(periodRange('today', now)).toEqual({ from: '2026-11-20', to: '2026-11-20' })
    expect(periodRange('this_week', now)).toEqual({ from: '2026-11-16', to: '2026-11-20' })
    expect(periodRange('this_month', now)).toEqual({ from: '2026-11-01', to: '2026-11-20' })
    expect(periodRange('last_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('this_year', now)).toEqual({ from: '2026-01-01', to: '2026-11-20' })
  })
  it('last month across a year end, and a Sunday week', () => {
    expect(periodRange('last_month', new Date(2027, 0, 5))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(periodRange('this_week', new Date(2026, 10, 22))).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })
  it('knows which period a From/To pair is', () => {
    expect(periodOf('2026-10-01', '2026-10-31', now)).toBe('last_month')
    expect(periodOf('2026-10-02', '2026-10-31', now)).toBeNull()
    expect(periodOf('', '', now)).toBeNull()
  })
})
