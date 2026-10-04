import type { Prisma } from '@prisma/client'
import { roundMoney } from '@/lib/accounting/money'
import {
  bankAccountIdForPaymentMethod,
  bankAccountLabelForId,
} from '@/lib/accounting/expense-pos-accounts'
import { commitPosting, type PostingLineInput } from '@/lib/accounting/posting-service'

export const LOAN_LIABILITY_ACCOUNT = '3401 - Bank Loan'
export const LOAN_INTEREST_ACCOUNT = '6701 - Interest Expense'

/** Loan received: Dr bank, Cr Bank Loan (a liability, not income). */
export function buildLoanDrawdownLines(params: {
  amount: number
  ref: string
  lender: string
  bankAccountId?: string
  method?: string
}): PostingLineInput[] {
  const amount = roundMoney(params.amount)
  const bankId = bankAccountIdForPaymentMethod(params.method, params.bankAccountId)
  return [
    { accountLabel: bankAccountLabelForId(bankId, params.method), description: `Loan received ${params.ref}: ${params.lender}`, debit: amount, credit: 0 },
    { accountLabel: LOAN_LIABILITY_ACCOUNT, description: `Loan ${params.ref}: ${params.lender}`, debit: 0, credit: amount },
  ]
}

/** Repayment: principal reduces the loan, interest is expense, bank pays both. */
export function buildLoanRepaymentLines(params: {
  principal: number
  interest: number
  ref: string
  lender: string
  bankAccountId?: string
  method?: string
}): PostingLineInput[] {
  const principal = roundMoney(params.principal)
  const interest = roundMoney(params.interest)
  const bankId = bankAccountIdForPaymentMethod(params.method, params.bankAccountId)
  return [
    ...(principal > 0 ? [{ accountLabel: LOAN_LIABILITY_ACCOUNT, description: `Principal repaid ${params.ref}: ${params.lender}`, debit: principal, credit: 0 }] : []),
    ...(interest > 0 ? [{ accountLabel: LOAN_INTEREST_ACCOUNT, description: `Interest ${params.ref}: ${params.lender}`, debit: interest, credit: 0 }] : []),
    { accountLabel: bankAccountLabelForId(bankId, params.method), description: `Loan repayment ${params.ref}`, debit: 0, credit: roundMoney(principal + interest) },
  ]
}

function journalCodeFor(method?: string, bankAccountId?: string) {
  const id = bankAccountIdForPaymentMethod(method, bankAccountId)
  return id === 'cash' || id === 'mpesa' ? 'CSH' : 'BNK'
}

/** Idempotent on `JRN/LOAN/<ref>`. */
export async function postLoanDrawdown(params: {
  loanId: string; ref: string; lender: string; amount: number
  bankAccountId?: string; method?: string; date?: string; createdById?: string
  tx?: Prisma.TransactionClient
}) {
  const amount = roundMoney(params.amount)
  if (amount <= 0) return null
  return commitPosting({
    ref: `JRN/LOAN/${params.ref}`,
    source: 'loan',
    description: `Loan received — ${params.ref} (${params.lender})`,
    date: params.date,
    blobId: `${params.loanId}:drawdown`,
    lines: buildLoanDrawdownLines({ amount, ref: params.ref, lender: params.lender, bankAccountId: params.bankAccountId, method: params.method }),
    createdById: params.createdById,
    journalCode: journalCodeFor(params.method, params.bankAccountId),
    tx: params.tx,
  })
}

/** Idempotent on `JRN/LNPAY/<repayment ref>`. */
export async function postLoanRepayment(params: {
  loanId: string; ref: string; loanRef: string; lender: string
  principal: number; interest: number
  bankAccountId?: string; method?: string; date?: string; createdById?: string
  tx?: Prisma.TransactionClient
}) {
  if (roundMoney(params.principal) + roundMoney(params.interest) <= 0) return null
  return commitPosting({
    ref: `JRN/LNPAY/${params.ref}`,
    source: 'loan',
    description: `Loan repayment — ${params.loanRef} (${params.lender})`,
    date: params.date,
    blobId: `${params.loanId}:${params.ref}`,
    lines: buildLoanRepaymentLines({
      principal: params.principal, interest: params.interest, ref: params.loanRef,
      lender: params.lender, bankAccountId: params.bankAccountId, method: params.method,
    }),
    createdById: params.createdById,
    journalCode: journalCodeFor(params.method, params.bankAccountId),
    tx: params.tx,
  })
}
