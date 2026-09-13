import { describe, expect, it } from 'vitest'
import { budgetVariance, signedActual } from '@/lib/accounting/budget-variance'

describe('analytic budget variance', () => {
  it('uses debit minus credit for expense actuals', () => {
    expect(signedActual({ debit: 1200, credit: 200, accountType: 'expense' })).toBe(1000)
  })

  it('uses credit minus debit for revenue actuals', () => {
    expect(signedActual({ debit: 100, credit: 1600, accountType: 'revenue' })).toBe(1500)
  })

  it('returns remaining budget and achievement', () => {
    expect(budgetVariance({ plannedAmount: 2000, debit: 1250, credit: 50, accountType: 'expense' }))
      .toEqual({ planned: 2000, actual: 1200, variance: 800, achievementPct: 60 })
  })

  it('does not invent a percentage for a zero plan', () => {
    expect(budgetVariance({ plannedAmount: 0, debit: 10, credit: 0, accountType: 'expense' }).achievementPct)
      .toBeNull()
  })
})
