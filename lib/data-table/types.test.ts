import { describe, expect, it, vi } from 'vitest'
import { getColumnValue, type ColumnDef } from './types'

type Row = { name: string; amount: number }

describe('getColumnValue', () => {
  const row: Row = { name: 'Acme', amount: 1250 }

  it('keeps search and export values separate from rendered output', () => {
    const render = vi.fn(() => 'formatted output')
    const column: ColumnDef<Row> = {
      key: 'amount',
      label: 'Amount',
      priority: 1,
      accessor: item => item.amount,
      searchValue: item => `${item.name} ${item.amount}`,
      exportValue: item => item.amount,
      render,
    }

    expect(getColumnValue(column, row, 'search')).toBe('Acme 1250')
    expect(getColumnValue(column, row, 'filter')).toBe(1250)
    expect(getColumnValue(column, row, 'export')).toBe(1250)
    expect(render).not.toHaveBeenCalled()
  })

  it('retains the render fallback for legacy columns', () => {
    const column: ColumnDef<Row> = {
      key: 'name',
      label: 'Name',
      priority: 1,
      render: item => item.name,
    }

    expect(getColumnValue(column, row, 'search')).toBe('Acme')
    expect(getColumnValue(column, row, 'export')).toBe('Acme')
  })
})
