import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyDepositToInvoice } from '@/lib/accounting/deposit-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    if (!body.invoiceId) {
      return NextResponse.json({
        error: 'invoiceId is required. Deposit completion cannot recognize revenue directly; apply the liability to a posted invoice.',
      }, { status: 409 })
    }
    const result = await applyDepositToInvoice({
      depositId: params.id,
      invoiceId: String(body.invoiceId),
      amount: body.amount == null ? undefined : Number(body.amount),
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json({ ok: true, ...result })
  })
}
