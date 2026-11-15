import { describe, expect, it } from 'vitest'
import {
  resolveDateRange, isWithinRange, filterByDateRange, describeDateRange, isOpenRange, ALL_DATES,
} from '@/lib/data-table/date-filter'

// A Sunday in the middle of November, so month, quarter and year edges all differ.
const TODAY = new Date(Date.UTC(2026, 10, 15))

describe('date periods', () => {
  it('resolves the periods a person asks for', () => {
    expect(resolveDateRange({ preset: 'today' }, TODAY)).toEqual({ from: '2026-11-15', to: '2026-11-15' })
    expect(resolveDateRange({ preset: 'last_7' }, TODAY)).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(resolveDateRange({ preset: 'this_month' }, TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(resolveDateRange({ preset: 'last_month' }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolveDateRange({ preset: 'this_quarter' }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(resolveDateRange({ preset: 'this_year' }, TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('counts the last 7 days inclusive of today', () => {
    const { from, to } = resolveDateRange({ preset: 'last_7' }, TODAY)
    expect(isWithinRange(from, { preset: 'last_7' }, TODAY)).toBe(true)
    expect(isWithinRange(to, { preset: 'last_7' }, TODAY)).toBe(true)
    expect(isWithinRange('2026-11-08', { preset: 'last_7' }, TODAY)).toBe(false)
  })

  it('crosses a year boundary without arithmetic going wrong', () => {
    const january = new Date(Date.UTC(2026, 0, 10))
    expect(resolveDateRange({ preset: 'last_month' }, january)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolveDateRange({ preset: 'last_30' }, january)).toEqual({ from: '2025-12-12', to: '2026-01-10' })
  })

  it('ends February on its real last day', () => {
    expect(resolveDateRange({ preset: 'this_month' }, new Date(Date.UTC(2026, 1, 3))).to).toBe('2026-02-28')
    expect(resolveDateRange({ preset: 'this_month' }, new Date(Date.UTC(2028, 1, 3))).to).toBe('2028-02-29')
  })
})

describe('filtering a list', () => {
  const rows = [
    { ref: 'A', date: '2026-10-31' },
    { ref: 'B', date: '2026-11-01' },
    { ref: 'C', date: '2026-11-15T09:30:00Z' },
    { ref: 'D', date: '2026-11-30' },
    { ref: 'E', date: '2026-12-01' },
    { ref: 'F', date: '' },
  ]
  const refs = (range: Parameters<typeof filterByDateRange>[2]) =>
    filterByDateRange(rows, r => r.date, range, TODAY).map(r => r.ref)

  it('keeps both boundary days', () => {
    expect(refs({ preset: 'this_month' })).toEqual(['B', 'C', 'D'])
  })

  it('reads a timestamp as the day it falls on', () => {
    expect(isWithinRange('2026-11-15T23:59:59Z', { preset: 'today' }, TODAY)).toBe(true)
  })

  it('leaves the list alone when no period is chosen', () => {
    expect(refs(ALL_DATES)).toHaveLength(rows.length)
    expect(isOpenRange(ALL_DATES)).toBe(true)
    expect(isOpenRange({ preset: 'custom' })).toBe(true)
  })

  it('filters on whichever end of a custom range is filled', () => {
    expect(refs({ preset: 'custom', from: '2026-11-15' })).toEqual(['C', 'D', 'E'])
    expect(refs({ preset: 'custom', to: '2026-11-01' })).toEqual(['A', 'B'])
    expect(refs({ preset: 'custom', from: '2026-11-01', to: '2026-11-15' })).toEqual(['B', 'C'])
  })

  // A record with no date is not evidence that it falls inside the period.
  it('leaves undated records out of a period', () => {
    expect(refs({ preset: 'this_month' })).not.toContain('F')
    expect(isWithinRange(null, { preset: 'today' }, TODAY)).toBe(false)
    expect(isWithinRange('not a date', { preset: 'today' }, TODAY)).toBe(false)
  })
})

describe('what the chip says', () => {
  it('names the period, or the dates when they were typed', () => {
    expect(describeDateRange({ preset: 'this_month' }, TODAY)).toBe('This month')
    expect(describeDateRange({ preset: 'custom', from: '2026-11-01', to: '2026-11-15' }, TODAY)).toBe('2026-11-01 – 2026-11-15')
    expect(describeDateRange({ preset: 'custom', from: '2026-11-01' }, TODAY)).toBe('From 2026-11-01')
    expect(describeDateRange({ preset: 'custom', to: '2026-11-15' }, TODAY)).toBe('Until 2026-11-15')
    expect(describeDateRange(ALL_DATES, TODAY)).toBe('Any date')
  })
})
