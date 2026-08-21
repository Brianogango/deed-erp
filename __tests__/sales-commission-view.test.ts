import { describe, it, expect } from 'vitest'
import {
  summarizeCommissions,
  monthsInQuarter,
  periodMonthsFromKey,
  type CommissionRowView,
} from '@/lib/accounting/sales-commission-view'

function row(over: Partial<CommissionRowView>): CommissionRowView {
  return {
    id: over.id ?? 'c1',
    employeeId: over.employeeId ?? 'emp-1',
    employeeName: over.employeeName ?? 'Ada',
    periodMonth: over.periodMonth ?? 8,
    periodYear: over.periodYear ?? 2026,
    saleAmount: over.saleAmount ?? 10000,
    commissionRate: over.commissionRate ?? 5,
    commissionAmount: over.commissionAmount ?? 500,
    isPaid: over.isPaid ?? false,
    ...over,
  }
}

describe('summarizeCommissions', () => {
  it('totals sale and commission and splits accrued vs paid per employee', () => {
    const summary = summarizeCommissions([
      row({ id: 'a', employeeId: 'emp-1', employeeName: 'Ada', saleAmount: 10000, commissionAmount: 500, isPaid: false }),
      row({ id: 'b', employeeId: 'emp-1', employeeName: 'Ada', saleAmount: 4000, commissionAmount: 200, isPaid: true }),
      row({ id: 'c', employeeId: 'emp-2', employeeName: 'Ben', saleAmount: 8000, commissionAmount: 240, isPaid: false }),
    ])
    expect(summary.saleAmount).toBe(22000)
    expect(summary.commissionAmount).toBe(940)
    expect(summary.accrued).toBe(740)
    expect(summary.paid).toBe(200)
    expect(summary.byEmployee).toEqual([
      {
        employeeId: 'emp-1',
        employeeName: 'Ada',
        saleAmount: 14000,
        commissionAmount: 700,
        accrued: 500,
        paid: 200,
        lines: 2,
      },
      {
        employeeId: 'emp-2',
        employeeName: 'Ben',
        saleAmount: 8000,
        commissionAmount: 240,
        accrued: 240,
        paid: 0,
        lines: 1,
      },
    ])
  })

  it('returns zeros for an empty ledger', () => {
    expect(summarizeCommissions([])).toEqual({
      saleAmount: 0,
      commissionAmount: 0,
      accrued: 0,
      paid: 0,
      byEmployee: [],
    })
  })
})

describe('monthsInQuarter', () => {
  it('returns the three 1-indexed months for Q3', () => {
    expect(monthsInQuarter(2026, 3)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ])
  })
})

describe('periodMonthsFromKey', () => {
  it('parses a calendar month key', () => {
    expect(periodMonthsFromKey('2026-08')).toEqual([{ year: 2026, month: 8 }])
  })

  it('parses a quarter key', () => {
    expect(periodMonthsFromKey('2026-Q1')).toEqual([
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ])
  })

  it('returns empty for an unknown key', () => {
    expect(periodMonthsFromKey('year')).toEqual([])
  })
})
