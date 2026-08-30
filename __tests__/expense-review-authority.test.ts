import { describe, expect, it } from 'vitest'
import {
  canUserReviewExpense,
  type ExpenseApprovalStep,
} from '@/lib/expense-approval-chain'

const chain = (role: string): ExpenseApprovalStep[] => [
  { role, status: 'pending' },
]

describe('expense review authority', () => {
  it('allows Director to override any pending expense approval step', () => {
    expect(canUserReviewExpense('director', chain('finance_officer'))).toBe(true)
    expect(canUserReviewExpense('director', chain('admin_officer'))).toBe(true)
  })

  it('allows Finance Officer only on the finance-officer step', () => {
    expect(canUserReviewExpense('finance_officer', chain('finance_officer'))).toBe(true)
    expect(canUserReviewExpense('finance_officer', chain('director'))).toBe(false)
  })

  it('allows legacy no-chain expenses for Director and Finance only', () => {
    expect(canUserReviewExpense('director', [])).toBe(true)
    expect(canUserReviewExpense('finance_officer', undefined)).toBe(true)
    expect(canUserReviewExpense('admin_officer', [])).toBe(false)
  })

  it('does not allow review once the chain has no pending step', () => {
    expect(canUserReviewExpense('director', [{ role: 'finance_officer', status: 'approved' }])).toBe(false)
  })
})
