import { describe, expect, it } from 'vitest'
import { compareSortValues, nextSortState } from '@/lib/data-table/sort'
import { getColumnSortValue, isColumnSortable, type ColumnDef } from '@/lib/data-table/types'
import { sortRepairsNewestFirst } from '@/lib/repair-list-sort'

describe('data-table sort', () => {
  it('sorts ISO intake dates chronologically', () => {
    expect(compareSortValues('2026-06-24', '2026-08-04')).toBeLessThan(0)
    expect(compareSortValues('2026-08-04T10:00:00Z', '2026-06-23')).toBeGreaterThan(0)
  })

  it('sorts amounts numerically', () => {
    expect(compareSortValues(1500, 6000)).toBeLessThan(0)
    expect(compareSortValues('6000', '1500')).toBeGreaterThan(0)
  })

  it('pushes blank values last', () => {
    expect(compareSortValues(null, 'a')).toBeGreaterThan(0)
    expect(compareSortValues('a', '')).toBeLessThan(0)
  })

  it('cycles sort state asc → desc → clear when no fallback', () => {
    expect(nextSortState(null, 'intakeDate')).toEqual({ key: 'intakeDate', direction: 'asc' })
    expect(nextSortState({ key: 'intakeDate', direction: 'asc' }, 'intakeDate')).toEqual({
      key: 'intakeDate',
      direction: 'desc',
    })
    expect(nextSortState({ key: 'intakeDate', direction: 'desc' }, 'intakeDate')).toBeNull()
    expect(nextSortState({ key: 'status', direction: 'asc' }, 'intakeDate')).toEqual({
      key: 'intakeDate',
      direction: 'asc',
    })
  })

  it('toggles asc ↔ desc and never clears when a defaultSort fallback is set', () => {
    const fallback = { key: 'intakeDate', direction: 'desc' as const }
    expect(nextSortState(fallback, 'intakeDate', fallback)).toEqual({
      key: 'intakeDate',
      direction: 'asc',
    })
    expect(nextSortState({ key: 'intakeDate', direction: 'asc' }, 'intakeDate', fallback)).toEqual({
      key: 'intakeDate',
      direction: 'desc',
    })
    expect(nextSortState({ key: 'status', direction: 'asc' }, 'intakeDate', fallback)).toEqual(fallback)
  })

  it('resolves sort values from row keys and marks columns sortable by default', () => {
    const column: ColumnDef<{ intakeDate: string; total: number }> = {
      key: 'intakeDate',
      label: 'Intake Date',
      priority: 3,
      render: () => null,
    }
    expect(isColumnSortable(column)).toBe(true)
    expect(getColumnSortValue(column, { intakeDate: '2026-08-04', total: 1 })).toBe('2026-08-04')
    expect(isColumnSortable({ ...column, sortable: false })).toBe(false)
  })
})

describe('sortRepairsNewestFirst', () => {
  it('puts latest intake dates first and breaks ties by createdDate', () => {
    const sorted = sortRepairsNewestFirst([
      { ref: 'REP-1', intakeDate: '2026-06-24', createdDate: '2026-06-24T08:00:00Z' },
      { ref: 'REP-2', intakeDate: '2026-08-04T09:00:00Z', createdDate: '2026-08-04T09:00:00Z' },
      { ref: 'REP-3', intakeDate: '2026-08-04T15:00:00Z', createdDate: '2026-08-04T15:00:00Z' },
      { ref: 'REP-4', intakeDate: '2026-06-23' },
    ])
    expect(sorted.map(r => r.ref)).toEqual(['REP-3', 'REP-2', 'REP-1', 'REP-4'])
  })
})
