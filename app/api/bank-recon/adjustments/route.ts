import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { canManageBankRecon } from '@/lib/finance-controls'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { postBankStatementAdjustment } from '@/lib/accounting/posting-service'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bank-recon/adjustments
 * Post bank charge / interest journals for unmatched statement categories.
 * Requires Finance/Director seal.
 *
 * Body: {
 *   kind: 'bank_charge' | 'interest_earned',
 *   amount: number,
 *   bankAccountId: string,
 *   month: string,           // YYYY-MM
 *   date?: string,
 *   statementLineId?: string,
 *   description?: string
 * }
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    if (!canManageBankRecon(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can post bank recon adjustments' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const kind = body.kind === 'interest_earned' ? 'interest_earned' : body.kind === 'bank_charge' ? 'bank_charge' : null
    if (!kind) {
      return NextResponse.json({ error: 'kind must be bank_charge or interest_earned' }, { status: 400 })
    }

    const amount = roundMoney(body.amount)
    if (amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const bankAccountId = String(body.bankAccountId || '').trim()
    const month = String(body.month || '').trim()
    if (!bankAccountId || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'bankAccountId and month (YYYY-MM) are required' }, { status: 400 })
    }

    const date = body.date ? String(body.date) : `${month}-28`
    const lock = await checkFiscalLock(new Date(date.includes('T') ? date : `${date}T00:00:00Z`))
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const journal = await postBankStatementAdjustment({
      kind,
      amount,
      bankAccountId,
      month,
      date,
      statementLineId: body.statementLineId ? String(body.statementLineId) : undefined,
      description: body.description ? String(body.description) : undefined,
      createdById: actor.id,
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'post_bank_recon_adjustment',
      entityType: 'bank_recon',
      entityId: `${bankAccountId}/${month}`,
      newValues: {
        kind,
        amount,
        statementLineId: body.statementLineId ?? null,
        journalRef: journal && 'ref' in journal ? journal.ref : null,
      },
    })

    return NextResponse.json({ journal, kind, amount })
  })
}
