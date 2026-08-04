import { describe, expect, it } from 'vitest'
import { compareSortValues, nextSortState } from '@/lib/data-table/sort'
import { getColumnSortValue, isColumnSortable, type ColumnDef } from '@/lib/data-table/types'

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

  it('cycles sort state asc → desc → clear', () => {
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
