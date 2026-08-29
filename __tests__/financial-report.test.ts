/**
 * The comprehensive financial report composes P&L + balance sheet + cash
 * flow + trial balance + a daily revenue/expense breakdown from posted GL
 * journals — the source-of-truth period report.
 */
import { describe, it, expect, vi } from 'vitest'

const { mockPrisma, mockBuilders } = vi.hoisted(() => ({
  mockPrisma: { $queryRaw: vi.fn() },
  mockBuilders: {
    buildManagementProfitAndLoss: vi.fn(),
    buildBalanceSheet: vi.fn(),
    buildCashFlowStatement: vi.fn(),
    buildTrialBalance: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/accounting/gl-reports', () => ({
  buildManagementProfitAndLoss: mockBuilders.buildManagementProfitAndLoss,
  buildBalanceSheet: mockBuilders.buildBalanceSheet,
  buildTrialBalance: mockBuilders.buildTrialBalance,
}))
vi.mock('@/lib/accounting/cash-flow.server', () => ({
  buildCashFlowStatement: mockBuilders.buildCashFlowStatement,
}))

import { buildFinancialReport } from '@/lib/accounting/financial-report'

describe('buildFinancialReport', () => {
  it('composes all sections for the period', async () => {
    mockBuilders.buildManagementProfitAndLoss.mockResolvedValue({ totalRevenue: 10000, totalExpenses: 4000, netProfit: 6000 })
    mockBuilders.buildBalanceSheet.mockResolvedValue({ asOf: '2026-08-29', totalAssets: 50000, totalLiabilities: 20000, totalEquity: 30000, balanced: true })
    mockBuilders.buildCashFlowStatement.mockResolvedValue({ openingCash: 5000, closingCash: 8000, totalOperating: 3000, totalInvesting: 0, totalFinancing: 0 })
    mockBuilders.buildTrialBalance.mockResolvedValue({ asOf: '2026-08-29', balanced: true, totals: { debit: 90000, credit: 90000 }, rows: [] })
    mockPrisma.$queryRaw.mockResolvedValue([
      { day: '2026-08-28', revenue: '6000', expenses: '2500' },
      { day: '2026-08-29', revenue: '4000', expenses: '1500' },
    ])

    const report = await buildFinancialReport({ dateFrom: '2026-08-28', dateTo: '2026-08-29' })
    expect(report.period).toEqual({ dateFrom: '2026-08-28', dateTo: '2026-08-29' })
    expect(report.profitLoss.netProfit).toBe(6000)
    expect(report.balanceSheet.balanced).toBe(true)
    expect(report.cashFlow.closingCash).toBe(8000)
    expect(report.trialBalance.balanced).toBe(true)
    expect(report.daily).toHaveLength(2)
    expect(report.daily[0]).toEqual({ date: '2026-08-28', revenue: 6000, expenses: 2500, net: 3500 })
    expect(mockBuilders.buildManagementProfitAndLoss).toHaveBeenCalledWith({ dateFrom: '2026-08-28', dateTo: '2026-08-29' })
    expect(mockBuilders.buildBalanceSheet).toHaveBeenCalledWith({ asOf: '2026-08-29' })
  })
})
