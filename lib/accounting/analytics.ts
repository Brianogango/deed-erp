/**
 * Analytic distribution helpers (Finance Phase 12).
 */

import { roundMoney } from '@/lib/accounting/money'

export type AnalyticSplit = {
  analyticAccountId: string
  percentage: number
}

export type AnalyticAmountSplit = {
  analyticAccountId: string
  percentage: number
  amount: number
}

export function distributeAnalyticAmount(
  amount: number,
  splits: AnalyticSplit[],
): AnalyticAmountSplit[] {
  const totalPct = splits.reduce((s, x) => s + Number(x.percentage || 0), 0)
  if (splits.length === 0) return []
  if (Math.abs(totalPct - 100) > 0.05 && Math.abs(totalPct - 1) > 0.0005) {
    throw new Error(`Analytic splits must total 100% (got ${totalPct})`)
  }
  const scale = totalPct > 1.5 ? 100 : 1
  const abs = roundMoney(Number(amount) || 0)
  const out: AnalyticAmountSplit[] = []
  let allocated = 0
  splits.forEach((s, i) => {
    const pct = Number(s.percentage || 0) / scale
    const isLast = i === splits.length - 1
    const part = isLast ? roundMoney(abs - allocated) : roundMoney(abs * pct)
    allocated = roundMoney(allocated + part)
    out.push({
      analyticAccountId: s.analyticAccountId,
      percentage: roundMoney(pct * 100),
      amount: part,
    })
  })
  return out
}

export type BudgetActualRow = {
  accountCode?: string | null
  analyticAccountId?: string | null
  budgetAmount: number
  actualAmount: number
  variance: number
}

export function budgetVariance(
  budgetAmount: number,
  actualAmount: number,
): number {
  return roundMoney(Number(budgetAmount || 0) - Number(actualAmount || 0))
}
