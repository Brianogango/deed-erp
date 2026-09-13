import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { canReimburseExpense, canReviewExpense } from '@/lib/finance-controls'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import {
  postExpenseApproval,
  postExpenseCompanyPayment,
  postExpenseReimbursement,
} from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/expenses/post-journal
 * Expense approve / reimburse journals + financial audit in one transaction.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])

    const body = await request.json().catch(() => ({}))
    const kind = body.kind === 'reimbursement'
      ? 'reimbursement'
      : body.kind === 'payment'
        ? 'payment'
        : body.kind === 'approval'
          ? 'approval'
          : null
    if (!kind) {
      return NextResponse.json({ error: 'kind must be approval, payment, or reimbursement' }, { status: 400 })
    }

    if (kind === 'approval' && !canReviewExpense(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can post expense approvals' }, { status: 403 })
    }
    if ((kind === 'reimbursement' || kind === 'payment') && !canReimburseExpense(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can post expense payments' }, { status: 403 })
    }

    const expenseId = String(body.expenseId || '').trim()
    const ref = String(body.ref || '').trim()
    const amount = roundMoney(body.amount)
    if (!expenseId || !ref || amount <= 0) {
      return NextResponse.json({ error: 'expenseId, ref, and positive amount are required' }, { status: 400 })
    }

    const date = String(body.date || '').trim()
    if (!date) {
      return NextResponse.json({ error: 'Expense posting date is required' }, { status: 422 })
    }
    const parsedDate = new Date(date.includes('T') ? date : `${date}T00:00:00Z`)
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'Expense posting date is invalid' }, { status: 422 })
    }
    const lock = await checkFiscalLock(parsedDate)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const journal = await prisma.$transaction(async tx => {
      const posted = kind === 'approval'
        ? await postExpenseApproval({
            expenseId,
            ref,
            description: String(body.description || ref),
            amount,
            category: body.category ? String(body.category) : undefined,
            paymentMethod: body.paymentMethod ? String(body.paymentMethod) : undefined,
            submittedByName: body.submittedByName ? String(body.submittedByName) : undefined,
            bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
            date,
            createdById: actor.id,
            tx,
          })
        : kind === 'payment'
          ? await postExpenseCompanyPayment({
              expenseId,
              ref,
              amount,
              paymentMethod: body.paymentMethod ? String(body.paymentMethod) : undefined,
              bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
              date,
              createdById: actor.id,
              tx,
            })
          : await postExpenseReimbursement({
              expenseId,
              ref,
              amount,
              submittedByName: body.submittedByName ? String(body.submittedByName) : undefined,
              bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
              date,
              createdById: actor.id,
              tx,
            })

      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: kind === 'approval'
          ? 'post_expense_engine'
          : kind === 'payment'
            ? 'post_expense_payment_engine'
            : 'post_expense_reimbursement_engine',
        entityType: 'expense',
        entityId: expenseId,
        relatedJournalId: posted && 'id' in posted ? String(posted.id) : null,
        newValues: {
          kind,
          ref,
          amount,
          journalRef: posted && 'ref' in posted ? posted.ref : null,
        },
      })

      return posted
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({ journal, kind, skipped: false })
  })
}
