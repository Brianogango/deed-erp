import { describe, expect, it } from 'vitest'
import {
  currentTargetPeriodKey,
  holdoverOverdueDays,
  inNairobiDateRange,
  previousTargetPeriodKeys,
  resolveHoldoverStatus,
  targetMetricProgress,
  targetOverallScore,
  targetPeriodBounds,
} from '@/lib/workspace-integrity'

describe('workspace integrity helpers', () => {
  it('does not mark an item due today in Nairobi as overdue', () => {
    const noonNairobi = new Date('2026-08-24T09:00:00.000Z')
    expect(resolveHoldoverStatus('2026-08-24T00:00:00.000Z', '', noonNairobi)).toBe('active')
    expect(holdoverOverdueDays('2026-08-24T00:00:00.000Z', noonNairobi)).toBe(0)
  })

  it('counts overdue days from expected return, not issue date', () => {
    expect(holdoverOverdueDays('2026-08-20', '2026-08-24')).toBe(4)
  })

  it('builds Nairobi-safe period boundaries', () => {
    expect(targetPeriodBounds('2026-08', 'monthly')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    })
    expect(targetPeriodBounds('2026-Q3', 'quarterly')).toEqual({
      start: '2026-07-01',
      end: '2026-09-30',
    })
  })

  it('generates distinct previous ISO weeks', () => {
    const now = new Date('2026-08-24T09:00:00.000Z')
    expect(currentTargetPeriodKey('weekly', now)).toBe('2026-W35')
    expect(previousTargetPeriodKeys('weekly', 3, now)).toEqual([
      '2026-W34',
      '2026-W33',
      '2026-W32',
    ])
  })

  it('uses continuous metric progress for the overall score', () => {
    expect(targetMetricProgress(720000, 1000000, 'min')).toBe(72)
    expect(targetMetricProgress(16, 20, 'min')).toBe(80)
    expect(targetMetricProgress(5, 4, 'max')).toBe(80)
    expect(targetOverallScore([
      { actual: 720000, target: 1000000, direction: 'min' },
      { actual: 16, target: 20, direction: 'min' },
      { actual: 15, target: 20, direction: 'min' },
      { actual: 36, target: 40, direction: 'min' },
    ])).toBe(79)
  })

  it('filters intake timestamps by Nairobi calendar day, not UTC midnight', () => {
    const eighthAfternoonUtc = '2026-09-08T14:18:08.614Z' // 17:18 Nairobi 8 Sep
    const ninthJustAfterMidnightNbo = '2026-09-08T21:30:00.000Z' // 00:30 Nairobi 9 Sep
    expect(inNairobiDateRange(eighthAfternoonUtc, '2026-09-08', '2026-09-08')).toBe(true)
    expect(inNairobiDateRange(eighthAfternoonUtc, '2026-09-09', '2026-09-09')).toBe(false)
    expect(inNairobiDateRange(ninthJustAfterMidnightNbo, '2026-09-08', '2026-09-08')).toBe(false)
    expect(inNairobiDateRange(ninthJustAfterMidnightNbo, '2026-09-09', '2026-09-09')).toBe(true)
    expect(inNairobiDateRange(eighthAfternoonUtc, '2026-09-08', '2026-09-09')).toBe(true)
    expect(inNairobiDateRange('', '2026-09-08', '2026-09-09')).toBe(false)
    expect(inNairobiDateRange(eighthAfternoonUtc, '', '')).toBe(true)
  })
})
