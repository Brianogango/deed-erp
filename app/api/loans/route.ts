import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { postLoanDrawdown } from '@/lib/accounting/loan-posting'
import { roundMoney } from '@/lib/accounting/money'
import { nextLoanRef, validateNewLoan, type Loan } from '@/lib/loans/loans'

export const dynamic = 'force-dynamic'

const LOANS_KEY = 'deed_loans'
const ROLES = ['director', 'finance_officer']

async function readLoans(): Promise<Loan[]> {
  const state = await loadAppState([LOANS_KEY])
  return Array.isArray(state[LOANS_KEY]) ? (state[LOANS_KEY] as Loan[]) : []
}

/** GET /api/loans — the loan register. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    return NextResponse.json({ loans: await readLoans() })
  })
}

/** POST /api/loans — record a loan; posts Dr bank / Cr 3401 unless already booked. */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))

    const input = {
      lender: String(body.lender ?? '').trim(),
      principal: roundMoney(body.principal),
      startDate: String(body.startDate ?? '').trim(),
    }
    const problem = validateNewLoan(input)
    if (problem) return NextResponse.json({ error: problem }, { status: 422 })

    const lock = await checkFiscalLock(input.startDate)
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })

    const loans = await readLoans()
    const drawdownBooked = body.drawdownBooked === true
    const loan: Loan = {
      id: crypto.randomUUID(),
      ref: nextLoanRef(loans),
      lender: input.lender,
      principal: input.principal,
      interestRate: Number.isFinite(Number(body.interestRate)) ? Number(body.interestRate) : undefined,
      termMonths: Number.isFinite(Number(body.termMonths)) ? Number(body.termMonths) : undefined,
      startDate: input.startDate,
      bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
      method: body.method ? String(body.method) : undefined,
      notes: body.notes ? String(body.notes).slice(0, 500) : undefined,
      drawdownBooked,
      drawdownJournalRef: null,
      status: 'active',
      repayments: [],
      createdAt: new Date().toISOString(),
      createdBy: actor.id,
    }

    if (!drawdownBooked) {
      const journal = await prisma.$transaction(async tx => {
        const posted = await postLoanDrawdown({
          loanId: loan.id, ref: loan.ref, lender: loan.lender, amount: loan.principal,
          bankAccountId: loan.bankAccountId, method: loan.method, date: loan.startDate,
          createdById: actor.id, tx,
        })
        await writeFinancialAuditInTx(tx, {
          userId: actor.id,
          action: 'post_loan_drawdown',
          entityType: 'loan',
          entityId: loan.id,
          relatedJournalId: posted && 'id' in posted ? String(posted.id) : null,
          newValues: { ref: loan.ref, lender: loan.lender, amount: loan.principal },
        })
        return posted
      }, { isolationLevel: 'Serializable' })
      loan.drawdownJournalRef = journal && 'ref' in journal ? String(journal.ref) : null
    }

    await saveStoreKeys({ [LOANS_KEY]: JSON.stringify([loan, ...loans]) })
    return NextResponse.json({ loan }, { status: 201 })
  })
}
