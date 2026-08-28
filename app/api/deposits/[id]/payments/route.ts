import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { addDepositReceipt } from '@/lib/accounting/deposit-service'

export const dynamic = 'force-dynamic'

/** Map deposit-service failures to actionable HTTP errors instead of a bare 500. */
function depositPaymentError(err: unknown): { message: string; status: number } {
  const e = err as { code?: string; message?: string }
  const message = e?.message || 'Deposit payment failed'
  if (e?.code === 'P2025') return { message: 'Deposit not found', status: 404 }
  if (/status|greater than zero|fully_paid|cancelled|completed/i.test(message)) return { message, status: 422 }
  return { message, status: 500 }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    let row
    try {
      row = await addDepositReceipt({
        depositId: params.id,
        amount: Number(body.amount),
        method: String(body.method || 'cash'),
        paymentRef: body.ref ? String(body.ref) : null,
        bankAccountId: body.bankAccountId ? String(body.bankAccountId) : null,
        idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : null,
        actor: { id: session.user.id, name: session.user.name },
      })
    } catch (err) {
      const mapped = depositPaymentError(err)
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }
    return NextResponse.json({
      ...row,
      totalValue: Number(row.totalValue),
      totalPaid: Number(row.totalPaid),
      balance: Number(row.balance),
    })
  })
}
