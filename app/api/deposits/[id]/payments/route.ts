import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { addDepositReceipt } from '@/lib/accounting/deposit-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const row = await addDepositReceipt({
      depositId: params.id,
      amount: Number(body.amount),
      method: String(body.method || 'cash'),
      paymentRef: body.ref ? String(body.ref) : null,
      bankAccountId: body.bankAccountId ? String(body.bankAccountId) : null,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : null,
      actor: { id: session.user.id, name: session.user.name },
    })
    return NextResponse.json({
      ...row,
      totalValue: Number(row.totalValue),
      totalPaid: Number(row.totalPaid),
      balance: Number(row.balance),
    })
  })
}
