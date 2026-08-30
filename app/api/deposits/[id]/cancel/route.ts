import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { refundDeposit } from '@/lib/accounting/deposit-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const depositRefundSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9_999_999_999.99).optional(),
  method: z.enum(['cash', 'mpesa', 'bank_transfer', 'card']).default('bank_transfer'),
  bankAccountId: z.string().trim().max(80).optional().nullable(),
  reference: z.string().trim().max(160).optional().nullable(),
  reason: z.string().trim().min(3).max(2_000),
}).strict()

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const parsed = depositRefundSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid deposit refund request' }, { status: 422 })
    }
    const body = parsed.data
    const result = await refundDeposit({
      depositId: params.id,
      amount: body.amount,
      method: body.method,
      bankAccountId: body.bankAccountId || null,
      reference: body.reference || null,
      reason: body.reason,
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json({ ok: true, ...result })
  })
}
