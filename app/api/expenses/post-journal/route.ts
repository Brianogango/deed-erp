import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { canReimburseExpense, canReviewExpense } from '@/lib/finance-controls'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
import {
  postExpenseApproval,
  postExpenseReimbursement,
} from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

/**
 * POST /api/expenses/post-journal
 * Dual-write expense approve / reimburse journals through the posting engine.
 * Blob UI journals remain SoT; this path fills Prisma GL when the flag is on.
 *
 * Body: {
 *   kind: 'approval' | 'reimbursement',
 *   expenseId: string,
 *   ref: string,
 *   amount: number,
 *   description?: string,
 *   category?: string,
 *   paymentMethod?: string,
 *   submittedByName?: string,
 *   bankAccountId?: string,
 *   date?: string
 * }
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])

    if (!isAccountingPostingEngineEnabled()) {
      return NextResponse.json({ skipped: true, reason: 'ACCOUNTING_POSTING_ENGINE off' })
    }

    const body = await request.json().catch(() => ({}))
    const kind = body.kind === 'reimbursement' ? 'reimbursement' : body.kind === 'approval' ? 'approval' : null
    if (!kind) {
      return NextResponse.json({ error: 'kind must be approval or reimbursement' }, { status: 400 })
    }

    if (kind === 'approval' && !canReviewExpense(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can post expense approvals' }, { status: 403 })
    }
    if (kind === 'reimbursement' && !canReimburseExpense(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can post expense reimbursements' }, { status: 403 })
    }

    const expenseId = String(body.expenseId || '').trim()
    const ref = String(body.ref || '').trim()
    const amount = roundMoney(body.amount)
    if (!expenseId || !ref || amount <= 0) {
      return NextResponse.json({ error: 'expenseId, ref, and positive amount are required' }, { status: 400 })
    }

    const date = body.date ? String(body.date) : undefined
    if (date) {
      const lock = await checkFiscalLock(new Date(date.includes('T') ? date : `${date}T00:00:00Z`))
      if (!lock.ok) {
        return NextResponse.json({ error: lock.error }, { status: lock.status })
      }
    }

    const journal = kind === 'approval'
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
        })
      : await postExpenseReimbursement({
          expenseId,
          ref,
          amount,
          submittedByName: body.submittedByName ? String(body.submittedByName) : undefined,
          bankAccountId: body.bankAccountId ? String(body.bankAccountId) : undefined,
          date,
          createdById: actor.id,
        })

    await writeFinancialAudit({
      userId: actor.id,
      action: kind === 'approval' ? 'post_expense_engine' : 'post_expense_reimbursement_engine',
      entityType: 'expense',
      entityId: expenseId,
      newValues: {
        kind,
        ref,
        amount,
        journalRef: journal && 'ref' in journal ? journal.ref : null,
      },
    })

    return NextResponse.json({ journal, kind, skipped: false })
  })
}
