import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { addDepositReceipt } from '@/lib/accounting/deposit-service'
import { z } from 'zod'
import { notifyStoreKeysChanged } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

// Recording a receipt posts a cash journal and can mark the deposit paid:
// same roles as creating or editing a deposit (app/api/deposits/route.ts).
const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']

const depositPaymentSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9_999_999_999.99),
  method: z.enum(['cash', 'mpesa', 'bank_transfer', 'card']).default('cash'),
  ref: z.string().trim().max(160).optional().nullable(),
  bankAccountId: z.string().trim().max(80).optional().nullable(),
  idempotencyKey: z.string().trim().max(160).optional().nullable(),
}).strict()

/** Map deposit-service failures to actionable HTTP errors instead of a bare 500. */
function depositPaymentError(err: unknown): { message: string; status: number } {
  const e = err as { code?: string; message?: string }
  const message = e?.message || 'Deposit payment failed'
  if (e?.code === 'P2025') return { message: 'Deposit not found', status: 404 }
  if (/status|greater than zero|fully_paid|cancelled|completed/i.test(message)) return { message, status: 422 }
  return { message, status: 500 }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(DEPOSIT_WRITE_ROLES)
    const parsed = depositPaymentSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid deposit payment' }, { status: 422 })
    }
    const body = parsed.data
    let row
    try {
      row = await addDepositReceipt({
        depositId: resolvedParams.id,
        amount: body.amount,
        method: body.method,
        paymentRef: body.ref || null,
        bankAccountId: body.bankAccountId || null,
        idempotencyKey: body.idempotencyKey || null,
        actor: { id: actor.id, name: actor.name },
      })
    } catch (err) {
      const mapped = depositPaymentError(err)
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }
    await notifyStoreKeysChanged(['deed_deposits'])
    return NextResponse.json({
      ...row,
      totalValue: Number(row.totalValue),
      totalPaid: Number(row.totalPaid),
      balance: Number(row.balance),
    })
  })
}
