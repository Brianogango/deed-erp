import 'server-only'
import prisma from '@/lib/prisma'
import {
  buildBalanceSheet,
  buildManagementProfitAndLoss,
  buildTrialBalance,
} from '@/lib/accounting/gl-reports'
import { buildCashFlowStatement } from '@/lib/accounting/cash-flow.server'

export type FinancialReportPeriod = {
  dateFrom: string
  dateTo: string
}

export type FinancialReportDailyRow = {
  date: string
  revenue: number
  expenses: number
  net: number
}

/**
 * Comprehensive financial report for a period: P&L + balance sheet + cash
 * flow + trial balance + daily revenue/expense breakdown. This is the
 * source-of-truth report — every figure derives from posted GL journals.
 */
export async function buildFinancialReport(opts: FinancialReportPeriod) {
  const { dateFrom, dateTo } = opts
  const [profitLoss, balanceSheet, cashFlow, trialBalance, dailyRows] = await Promise.all([
    buildManagementProfitAndLoss({ dateFrom, dateTo }),
    buildBalanceSheet({ asOf: dateTo }),
    buildCashFlowStatement({ dateFrom, dateTo }),
    buildTrialBalance({ asOf: dateTo }),
    prisma.$queryRaw<Array<{ day: string; revenue: string; expenses: string }>>`
      SELECT
        to_char(e.entry_date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(CASE WHEN a.account_type = 'revenue' THEN l.credit - l.debit ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN a.account_type = 'expense' THEN l.debit - l.credit ELSE 0 END), 0) AS expenses
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN account_codes a ON a.id = l.account_id
      WHERE e.is_posted = true
        AND e.entry_date >= ${dateFrom}::date
        AND e.entry_date <= ${dateTo}::date
        AND a.account_type IN ('revenue', 'expense')
      GROUP BY 1
      ORDER BY 1
    `,
  ])

  const daily: FinancialReportDailyRow[] = dailyRows.map((r: { day: string; revenue: string; expenses: string }) => {
    const revenue = Number(r.revenue)
    const expenses = Number(r.expenses)
    return { date: r.day, revenue, expenses, net: Math.round((revenue - expenses) * 100) / 100 }
  })

  return {
    period: { dateFrom, dateTo },
    generatedAt: new Date().toISOString(),
    profitLoss,
    balanceSheet,
    cashFlow,
    trialBalance: {
      asOf: trialBalance.asOf,
      balanced: trialBalance.balanced,
      totalDebit: trialBalance.totals.debit,
      totalCredit: trialBalance.totals.credit,
      accounts: trialBalance.rows,
    },
    daily,
  }
}
