import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyDepositToInvoice } from '@/lib/accounting/deposit-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const depositApplySchema = z.object({
  invoiceId: z.string().trim().min(1).max(80),
  amount: z.coerce.number().finite().positive().max(9_999_999_999.99).optional(),
}).strict()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const parsed = depositApplySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({
        error: 'A valid invoiceId is required. Deposit completion cannot recognize revenue directly; apply the liability to a posted invoice.',
      }, { status: 422 })
    }
    const body = parsed.data
    const result = await applyDepositToInvoice({
      depositId: resolvedParams.id,
      invoiceId: body.invoiceId,
      amount: body.amount,
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json({ ok: true, ...result })
  })
}
