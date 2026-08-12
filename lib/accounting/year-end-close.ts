/**
 * Year-end close into Current Year P&L (4003) — Finance Phase 12.
 * Pure builder; persistence via journal-service / posting engine.
 */

import { labelForRole } from '@/lib/accounting/coa-roles'
import { roundMoney } from '@/lib/accounting/money'

export type PlAccountBalance = {
  code: string
  name: string
  accountType: 'revenue' | 'expense' | string
  /** Credit-normal balance for revenue; debit-normal for expense (signed as TB). */
  debit: number
  credit: number
}

export type YearEndCloseLine = {
  accountLabel: string
  description: string
  debit: number
  credit: number
}

export function yearEndCloseRef(fiscalYear: number): string {
  return `JRN/YE/${fiscalYear}`.slice(0, 80)
}

/**
 * Close revenue (credit balances) and expense (debit balances) into 4003.
 * Net profit: credit 4003; net loss: debit 4003.
 */
export function buildYearEndCloseLines(
  accounts: PlAccountBalance[],
  fiscalYear: number,
): { lines: YearEndCloseLine[]; netProfit: number } {
  const lines: YearEndCloseLine[] = []
  let revenueCredit = 0
  let expenseDebit = 0

  for (const a of accounts) {
    const debit = roundMoney(Number(a.debit) || 0)
    const credit = roundMoney(Number(a.credit) || 0)
    const type = String(a.accountType || '').toLowerCase()
    const label = `${a.code} - ${a.name}`.slice(0, 200)

    if (type === 'revenue' || type === 'income') {
      const bal = roundMoney(credit - debit)
      if (Math.abs(bal) < 0.005) continue
      // Close revenue: Dr revenue, Cr 4003 later via net
      lines.push({
        accountLabel: label,
        description: `YE${fiscalYear} close revenue ${a.code}`,
        debit: bal > 0 ? bal : 0,
        credit: bal < 0 ? -bal : 0,
      })
      revenueCredit += bal
    } else if (type === 'expense' || type === 'cogs') {
      const bal = roundMoney(debit - credit)
      if (Math.abs(bal) < 0.005) continue
      // Close expense: Cr expense
      lines.push({
        accountLabel: label,
        description: `YE${fiscalYear} close expense ${a.code}`,
        debit: bal < 0 ? -bal : 0,
        credit: bal > 0 ? bal : 0,
      })
      expenseDebit += bal
    }
  }

  const netProfit = roundMoney(revenueCredit - expenseDebit)
  const cyLabel = labelForRole('current_year_pl')
  if (netProfit > 0) {
    lines.push({
      accountLabel: cyLabel,
      description: `YE${fiscalYear} net profit to ${cyLabel}`,
      debit: 0,
      credit: netProfit,
    })
  } else if (netProfit < 0) {
    lines.push({
      accountLabel: cyLabel,
      description: `YE${fiscalYear} net loss to ${cyLabel}`,
      debit: -netProfit,
      credit: 0,
    })
  }

  const d = roundMoney(lines.reduce((s, l) => s + l.debit, 0))
  const c = roundMoney(lines.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(d - c) > 0.02) {
    throw new Error(`Year-end close unbalanced: debit=${d} credit=${c}`)
  }

  return { lines, netProfit }
}
