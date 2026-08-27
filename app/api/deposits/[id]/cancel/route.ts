import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { refundDeposit } from '@/lib/accounting/deposit-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const reason = String(body.reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'Cancellation/refund reason is required' }, { status: 422 })
    const result = await refundDeposit({
      depositId: params.id,
      amount: body.amount == null ? undefined : Number(body.amount),
      method: String(body.method || 'bank_transfer'),
      bankAccountId: body.bankAccountId ? String(body.bankAccountId) : null,
      reference: body.reference ? String(body.reference) : null,
      reason,
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json({ ok: true, ...result })
  })
}
