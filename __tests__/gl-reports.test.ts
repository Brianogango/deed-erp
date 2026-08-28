import { describe, expect, it } from 'vitest'
import {
  aggregateJournalLines,
  buildBalanceSheetFromAggregates,
  buildProfitAndLossFromAggregates,
  buildTrialBalanceFromAggregates,
  netBalanceForType,
  round2,
} from '@/lib/accounting/gl-reports'

describe('gl-reports math', () => {
  it('rounds to two decimal places', () => {
    expect(round2(1.006)).toBe(1.01)
    expect(round2(1.004)).toBe(1)
  })

  it('computes net balance by account type', () => {
    expect(netBalanceForType('asset', 1000, 200)).toBe(800)
    expect(netBalanceForType('liability', 100, 500)).toBe(400)
    expect(netBalanceForType('revenue', 0, 5000)).toBe(5000)
    expect(netBalanceForType('expense', 3000, 500)).toBe(2500)
  })

  it('aggregates journal lines by account code', () => {
    const map = aggregateJournalLines([
      {
        accountId: 'a1',
        accountLabel: '5000 - Sales',
        debit: 0,
        credit: 1000,
        account: { code: '5000', name: 'Sales', accountType: 'revenue', accountGroup: 'Revenue - Products' },
      },
      {
        accountId: 'a1',
        accountLabel: '5000 - Sales',
        debit: 0,
        credit: 500,
        account: { code: '5000', name: 'Sales', accountType: 'revenue', accountGroup: 'Revenue - Products' },
      },
      {
        accountId: 'b1',
        accountLabel: '6001 - COGS',
        debit: 400,
        credit: 0,
        account: { code: '6001', name: 'COGS', accountType: 'expense', accountGroup: 'Direct Expenses' },
      },
    ])
    expect(map.get('5000')).toMatchObject({ debit: 0, credit: 1500 })
    expect(map.get('6001')).toMatchObject({ debit: 400, credit: 0 })
  })

  it('builds P&L from aggregates', () => {
    const map = aggregateJournalLines([
      {
        accountId: 'a1',
        accountLabel: '5000 - Sales',
        debit: 0,
        credit: 10000,
        account: { code: '5000', name: 'Sales', accountType: 'revenue', accountGroup: 'Revenue - Products' },
      },
      {
        accountId: 'b1',
        accountLabel: '6001 - COGS',
        debit: 6000,
        credit: 0,
        account: { code: '6001', name: 'COGS', accountType: 'expense', accountGroup: 'Direct Expenses' },
      },
    ])
    const pl = buildProfitAndLossFromAggregates(map, { dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    expect(pl.totalRevenue).toBe(10000)
    expect(pl.totalExpenses).toBe(6000)
    expect(pl.netProfit).toBe(4000)
    expect(pl.revenue).toHaveLength(1)
    expect(pl.expenses).toHaveLength(1)
  })

  it('builds balance sheet from aggregates', () => {
    const map = aggregateJournalLines([
      {
        accountId: 'a1',
        accountLabel: '2201 - ABSA Bank',
        debit: 50000,
        credit: 10000,
        account: { code: '2201', name: 'ABSA Bank', accountType: 'asset', accountGroup: 'Cash at Bank' },
      },
      {
        accountId: 'l1',
        accountLabel: '3000 - AP',
        debit: 0,
        credit: 20000,
        account: { code: '3000', name: 'AP', accountType: 'liability', accountGroup: 'Payables - Product' },
      },
      {
        accountId: 'e1',
        accountLabel: '4002 - Retained Earnings',
        debit: 0,
        credit: 20000,
        account: { code: '4002', name: 'Retained Earnings', accountType: 'equity', accountGroup: 'Equity' },
      },
    ])
    const bs = buildBalanceSheetFromAggregates(map, '2026-07-31')
    expect(bs.totalAssets).toBe(40000)
    expect(bs.totalLiabilities).toBe(20000)
    expect(bs.totalEquity).toBe(20000)
    expect(bs.balanced).toBe(true)
  })

  it('builds a cumulative trial balance from gross debit/credit nets', () => {
    const map = aggregateJournalLines([
      {
        accountId: 'a1',
        accountLabel: '1800 - AR',
        debit: 1000,
        credit: 200,
        account: { code: '1800', name: 'AR', accountType: 'asset', accountGroup: 'Receivables' },
      },
      {
        accountId: 'r1',
        accountLabel: 'REV/5000',
        debit: 0,
        credit: 800,
        account: { code: '5000', name: 'Sales', accountType: 'revenue', accountGroup: 'Revenue' },
      },
    ])
    const tb = buildTrialBalanceFromAggregates(map, '2026-08-27')
    expect(tb.asOf).toBe('2026-08-27')
    expect(tb.rows.find(r => r.code === '1800')).toMatchObject({ debit: 800, credit: 0, grossDebit: 1000, grossCredit: 200 })
    expect(tb.balanced).toBe(true)
  })

  it('fails closed when a journal line has no mapped account', () => {
    expect(() => aggregateJournalLines([
      { accountId: null, accountLabel: 'Mystery', debit: 10, credit: 0, account: null },
    ])).toThrow(/Unmapped journal account/)
  })
})
