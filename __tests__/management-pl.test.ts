import { describe, expect, it } from 'vitest'
import {
  buildManagementProfitAndLossFromAggregates,
  classifyExpenseBucket,
  isOtherIncomeGroup,
} from '@/lib/accounting/management-pl'
import type { AggregateLike } from '@/lib/accounting/management-pl'

function agg(partial: Partial<AggregateLike> & Pick<AggregateLike, 'code' | 'type' | 'debit' | 'credit'>): AggregateLike {
  return {
    name: partial.name || partial.code,
    group: partial.group || '',
    subGroup: partial.subGroup,
    ...partial,
  }
}

describe('management P&L classification', () => {
  it('classifies COGS by group and subGroup', () => {
    expect(classifyExpenseBucket({ group: 'Direct Expenses' })).toBe('cogs')
    expect(classifyExpenseBucket({ group: 'Local Purchases' })).toBe('cogs')
    expect(classifyExpenseBucket({ subGroup: 'COGS' })).toBe('cogs')
    expect(classifyExpenseBucket({ code: '6001' })).toBe('cogs')
  })

  it('classifies finance and operating costs', () => {
    expect(classifyExpenseBucket({ group: 'Finance Costs' })).toBe('finance')
    expect(classifyExpenseBucket({ code: '6703' })).toBe('finance')
    expect(classifyExpenseBucket({ group: 'Operating Expenses' })).toBe('operating')
    expect(classifyExpenseBucket({ code: '6519' })).toBe('operating')
  })

  it('detects other income groups', () => {
    expect(isOtherIncomeGroup('Other Income')).toBe(true)
    expect(isOtherIncomeGroup('Revenue - Products')).toBe(false)
  })
})

describe('buildManagementProfitAndLossFromAggregates', () => {
  it('builds revenue → COGS → gross → opex/finance → net', () => {
    const map = new Map<string, AggregateLike>([
      ['5000', agg({
        code: '5000', name: 'Sales', type: 'revenue', group: 'Revenue - Products', debit: 0, credit: 10000,
      })],
      ['5201', agg({
        code: '5201', name: 'Interest', type: 'revenue', group: 'Other Income', debit: 0, credit: 200,
      })],
      ['6001', agg({
        code: '6001', name: 'COGS', type: 'expense', group: 'Direct Expenses', subGroup: 'COGS', debit: 4000, credit: 0,
      })],
      ['6518', agg({
        code: '6518', name: 'Office', type: 'expense', group: 'Operating Expenses', debit: 1500, credit: 0,
      })],
      ['6703', agg({
        code: '6703', name: 'Bank Charges', type: 'expense', group: 'Financial Expenses', debit: 100, credit: 0,
      })],
    ])

    const pl = buildManagementProfitAndLossFromAggregates(map, {
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    })

    expect(pl.view).toBe('management')
    expect(pl.totalRevenue).toBe(10000)
    expect(pl.totalOtherIncome).toBe(200)
    expect(pl.totalIncome).toBe(10200)
    expect(pl.totalCogs).toBe(4000)
    expect(pl.grossProfit).toBe(6200)
    expect(pl.totalOperating).toBe(1500)
    expect(pl.totalFinance).toBe(100)
    expect(pl.totalExpenses).toBe(5600)
    expect(pl.netProfit).toBe(4600)
    expect(pl.byGroup.some(g => g.section === 'cogs' && g.group === 'Direct Expenses')).toBe(true)
  })

  it('keeps netProfit === totalIncome − totalExpenses', () => {
    const rows: AggregateLike[] = [
      agg({ code: '5000', type: 'revenue', group: 'Revenue - Products', debit: 0, credit: 1160 }),
      agg({ code: '6001', type: 'expense', group: 'Direct Expenses', debit: 500, credit: 0 }),
      agg({ code: '6499', type: 'expense', group: '', debit: 160, credit: 0 }),
    ]
    const pl = buildManagementProfitAndLossFromAggregates(rows)
    expect(pl.netProfit).toBe(round2Safe(pl.totalIncome - pl.totalExpenses))
    expect(pl.totalExpenses).toBe(pl.totalCogs + pl.totalOperating + pl.totalFinance)
  })
})

function round2Safe(n: number) {
  return Math.round(n * 100) / 100
}
