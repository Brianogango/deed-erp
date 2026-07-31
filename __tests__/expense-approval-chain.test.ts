import { describe, expect, it } from 'vitest'
import {
  buildExpenseApprovalChain,
  advanceExpenseApproval,
  expenseChainIsComplete,
  canUserApproveExpenseStep,
} from '@/lib/expense-approval-chain'

describe('expense approval chain', () => {
  it('defaults to finance_officer only under 50k', () => {
    const chain = buildExpenseApprovalChain(25000)
    expect(chain).toEqual([{ role: 'finance_officer', status: 'pending' }])
  })

  it('adds director above 50k', () => {
    const chain = buildExpenseApprovalChain(75000)
    expect(chain.map(s => s.role)).toEqual(['finance_officer', 'director'])
  })

  it('advances one step at a time', () => {
    const chain = buildExpenseApprovalChain(80000)
    const step1 = advanceExpenseApproval({ chain, approved: true, reviewerRole: 'finance_officer', reviewerName: 'Fin' })
    expect(expenseChainIsComplete(step1)).toBe(false)
    expect(canUserApproveExpenseStep('director', step1)).toBe(true)
    expect(canUserApproveExpenseStep('finance_officer', step1)).toBe(false)
    const step2 = advanceExpenseApproval({ chain: step1, approved: true, reviewerRole: 'director', reviewerName: 'Dir' })
    expect(expenseChainIsComplete(step2)).toBe(true)
  })
})
