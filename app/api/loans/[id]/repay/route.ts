import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { postLoanRepayment } from '@/lib/accounting/loan-posting'
import { roundMoney } from '@/lib/accounting/money'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { loanOutstanding, nextRepaymentRef, validateRepayment, type Loan } from '@/lib/loans/loans'

export const dynamic = 'force-dynamic'

const LOANS_KEY = 'deed_loans'

/** POST /api/loans/:id/repay — Dr 3401 (principal) + Dr 6701 (interest), Cr bank. */
export async function POST(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({}))

    const state = await loadAppState([LOANS_KEY])
    const loans: Loan[] = Array.isArray(state[LOANS_KEY]) ? (state[LOANS_KEY] as Loan[]) : []
    const loan = loans.find(l => l.id === id)
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })

    const principal = roundMoney(body.principal)
    const interest = roundMoney(body.interest)
    const date = String(body.date ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Payment date is required' }, { status: 422 })
    }
    const problem = validateRepayment(loan, { principal, interest })
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })

    const lock = await checkFiscalLock(date)
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })

    const ref = nextRepaymentRef(loan)
    const bankAccountId = body.bankAccountId ? String(body.bankAccountId) : loan.bankAccountId
    const method = body.method ? String(body.method) : loan.method

    const journal = await prisma.$transaction(async tx => {
      const posted = await postLoanRepayment({
        loanId: loan.id, ref, loanRef: loan.ref, lender: loan.lender,
        principal, interest, bankAccountId, method, date, createdById: actor.id, tx,
      })
      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: 'post_loan_repayment',
        entityType: 'loan',
        entityId: loan.id,
        relatedJournalId: posted && 'id' in posted ? String(posted.id) : null,
        newValues: { ref, principal, interest },
      })
      return posted
    }, { isolationLevel: 'Serializable' })

    loan.repayments = [
      ...loan.repayments,
      {
        id: crypto.randomUUID(), date, principal, interest, ref,
        journalRef: journal && 'ref' in journal ? String(journal.ref) : null,
        bankAccountId, method, recordedBy: actor.id,
      },
    ]
    if (loanOutstanding(loan) <= 0.005) loan.status = 'settled'
    await saveStoreKeys({ [LOANS_KEY]: JSON.stringify(loans) })
    return NextResponse.json({ loan, journal })
  })
}
