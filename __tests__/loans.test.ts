import { describe, it, expect } from 'vitest'
import {
  loanOutstanding, nextLoanRef, nextRepaymentRef, validateNewLoan, validateRepayment, type Loan,
} from '@/lib/loans/loans'
import { buildLoanDrawdownLines, buildLoanRepaymentLines } from '@/lib/accounting/loan-posting'

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'l1', ref: 'LN/0001', lender: 'NCBA', principal: 100000, startDate: '2026-10-01',
  status: 'active', repayments: [], createdAt: 'x', ...over,
})
const rep = (principal: number, interest = 0) => ({ id: 'r', date: '2026-11-01', principal, interest, ref: 'x' })

describe('loan register', () => {
  it('outstanding falls by principal only, never interest', () => {
    expect(loanOutstanding(loan({ repayments: [rep(10000, 1500), rep(10000, 1400)] }))).toBe(80000)
  })
  it('numbers loans and repayments', () => {
    expect(nextLoanRef([])).toBe('LN/0001')
    expect(nextLoanRef([{ ref: 'LN/0007' }, { ref: 'LN/0002' }])).toBe('LN/0008')
    expect(nextRepaymentRef(loan({ repayments: [rep(1)] }))).toBe('LN/0001/R02')
  })
  it('refuses over-repaying the principal, accepts interest on top', () => {
    const l = loan({ repayments: [rep(95000)] })
    expect(validateRepayment(l, { principal: 6000, interest: 0 })).toMatch(/more than/)
    expect(validateRepayment(l, { principal: 5000, interest: 800 })).toBeNull()
    expect(validateRepayment(l, { principal: 0, interest: 0 })).toMatch(/Enter/)
    expect(validateRepayment(loan({ status: 'settled' }), { principal: 1, interest: 0 })).toMatch(/fully repaid/)
  })
  it('validates a new loan', () => {
    expect(validateNewLoan({ lender: '', principal: 5, startDate: '2026-10-01' })).toBeTruthy()
    expect(validateNewLoan({ lender: 'X', principal: 0, startDate: '2026-10-01' })).toBeTruthy()
    expect(validateNewLoan({ lender: 'X', principal: 5, startDate: '' })).toBeTruthy()
    expect(validateNewLoan({ lender: 'X', principal: 5, startDate: '2026-10-01' })).toBeNull()
  })
})

describe('loan postings', () => {
  const sum = (ls: { debit: number; credit: number }[], k: 'debit' | 'credit') => ls.reduce((s, l) => s + l[k], 0)
  it('drawdown: Dr bank, Cr 3401 Bank Loan', () => {
    const ls = buildLoanDrawdownLines({ amount: 100000, ref: 'LN/0001', lender: 'NCBA' })
    expect(ls[1]).toMatchObject({ accountLabel: '3401 - Bank Loan', credit: 100000 })
    expect(sum(ls, 'debit')).toBe(sum(ls, 'credit'))
  })
  it('repayment: principal to 3401, interest to 6701, bank pays both, balanced', () => {
    const ls = buildLoanRepaymentLines({ principal: 10000, interest: 1500, ref: 'LN/0001', lender: 'NCBA' })
    expect(ls.find(l => l.accountLabel === '3401 - Bank Loan')?.debit).toBe(10000)
    expect(ls.find(l => l.accountLabel === '6701 - Interest Expense')?.debit).toBe(1500)
    expect(ls[ls.length - 1].credit).toBe(11500)
    expect(sum(ls, 'debit')).toBe(sum(ls, 'credit'))
  })
  it('interest-only repayment leaves principal untouched', () => {
    const ls = buildLoanRepaymentLines({ principal: 0, interest: 900, ref: 'LN/0001', lender: 'NCBA' })
    expect(ls.some(l => l.accountLabel === '3401 - Bank Loan')).toBe(false)
    expect(sum(ls, 'debit')).toBe(900)
  })
})
