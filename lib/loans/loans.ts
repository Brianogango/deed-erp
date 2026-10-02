/**
 * Loan register — pure helpers.
 *
 * A loan is a liability (3401 Bank Loan). Receiving the money is NOT income and
 * repaying principal is NOT an expense; only the interest is (6701).
 */
import { roundMoney } from '@/lib/accounting/money'

export type LoanRepayment = {
  id: string
  date: string
  principal: number
  interest: number
  ref: string
  journalRef?: string | null
  bankAccountId?: string
  method?: string
  recordedBy?: string
}

export type Loan = {
  id: string
  ref: string                 // LN/0001
  lender: string
  principal: number
  /** Annual rate in %, informational (interest is entered per repayment). */
  interestRate?: number
  termMonths?: number
  startDate: string           // YYYY-MM-DD
  bankAccountId?: string
  method?: string
  notes?: string
  /** True when the money received was already booked elsewhere — no drawdown journal. */
  drawdownBooked?: boolean
  drawdownJournalRef?: string | null
  status: 'active' | 'settled'
  repayments: LoanRepayment[]
  createdAt: string
  createdBy?: string
}

export function principalRepaid(loan: Pick<Loan, 'repayments'>): number {
  return roundMoney((loan.repayments ?? []).reduce((s, r) => s + (Number(r.principal) || 0), 0))
}

export function interestPaid(loan: Pick<Loan, 'repayments'>): number {
  return roundMoney((loan.repayments ?? []).reduce((s, r) => s + (Number(r.interest) || 0), 0))
}

/** Principal still owed. */
export function loanOutstanding(loan: Pick<Loan, 'principal' | 'repayments'>): number {
  return Math.max(0, roundMoney((Number(loan.principal) || 0) - principalRepaid(loan)))
}

export function nextLoanRef(loans: Pick<Loan, 'ref'>[]): string {
  const max = loans.reduce((m, l) => {
    const n = parseInt(String(l.ref).replace(/^LN\//, ''), 10)
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `LN/${String(max + 1).padStart(4, '0')}`
}

export function nextRepaymentRef(loan: Pick<Loan, 'ref' | 'repayments'>): string {
  return `${loan.ref}/R${String((loan.repayments?.length ?? 0) + 1).padStart(2, '0')}`
}

/** Returns an error message, or null when the repayment is acceptable. */
export function validateRepayment(
  loan: Pick<Loan, 'principal' | 'repayments' | 'status'>,
  input: { principal: number; interest: number },
): string | null {
  const principal = roundMoney(input.principal)
  const interest = roundMoney(input.interest)
  if (loan.status === 'settled') return 'This loan is already fully repaid'
  if (!(principal >= 0) || !(interest >= 0)) return 'Amounts cannot be negative'
  if (principal + interest <= 0) return 'Enter the principal and/or interest paid'
  const owed = loanOutstanding(loan)
  if (principal > owed + 0.005) {
    return `Principal ${principal.toLocaleString('en-KE')} is more than the ${owed.toLocaleString('en-KE')} still owed`
  }
  return null
}

export function validateNewLoan(input: { lender?: string; principal?: number; startDate?: string }): string | null {
  if (!String(input.lender ?? '').trim()) return 'Lender is required'
  if (!(roundMoney(input.principal) > 0)) return 'Loan amount must be greater than zero'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate ?? ''))) return 'Start date is required'
  return null
}
