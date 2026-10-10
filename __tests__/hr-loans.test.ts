import { describe, expect, it } from 'vitest'
import { allocateLoanRepayment, plannedLoanDeduction, type LoanLike } from '@/lib/hr/loans'

const loan = (id: string, issue: string, monthly: number, outstanding: number): LoanLike => ({ id, issueDate: issue, monthlyDeduction: monthly, outstanding })
const end = new Date('2026-09-30T00:00:00Z')

describe('staff loan repayment', () => {
  it('plans the monthly instalment, capped at what is still owed, and skips loans issued later', () => {
    const loans = [loan('a', '2026-01-01', 5000, 20000), loan('b', '2026-06-01', 5000, 3000), loan('c', '2026-10-15', 4000, 4000)]
    expect(plannedLoanDeduction(loans, end)).toBe(8000)
  })

  it('spreads a deduction over loans oldest first and clears a loan that reaches zero', () => {
    const loans = [loan('b', '2026-06-01', 5000, 3000), loan('a', '2026-01-01', 5000, 20000)]
    const alloc = allocateLoanRepayment(loans, 8000)
    expect(alloc).toEqual([
      { id: 'a', amount: 5000, outstandingAfter: 15000, cleared: false },
      { id: 'b', amount: 3000, outstandingAfter: 0, cleared: true },
    ])
  })

  it('recovers less when payroll deducted less than planned (deduction cap)', () => {
    const loans = [loan('a', '2026-01-01', 5000, 20000), loan('b', '2026-06-01', 5000, 8000)]
    const alloc = allocateLoanRepayment(loans, 6000)
    expect(alloc.map(a => [a.id, a.amount])).toEqual([['a', 5000], ['b', 1000]])
  })

  it('never allocates more than the instalment, even if more was deducted', () => {
    expect(allocateLoanRepayment([loan('a', '2026-01-01', 2000, 9000)], 5000)).toEqual([{ id: 'a', amount: 2000, outstandingAfter: 7000, cleared: false }])
  })
})
