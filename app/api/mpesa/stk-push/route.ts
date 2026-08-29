import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { startStkPush } from '@/lib/mpesa/service'

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as {
      phone?: string
      amount?: number
      accountReference?: string
      transactionDesc?: string
      source?: 'pos' | 'invoice'
      invoiceId?: string
    }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 1) {
      return NextResponse.json({ error: 'Amount must be at least KES 1' }, { status: 400 })
    }
    const record = await startStkPush({
      phone: String(body.phone || ''),
      amount,
      accountReference: String(body.accountReference || 'DEED'),
      transactionDesc: String(body.transactionDesc || 'Payment'),
      source: body.source === 'invoice' ? 'invoice' : 'pos',
      invoiceId: body.invoiceId || null,
      createdById: actor.user.id,
    })
    return NextResponse.json(record)
  })
}
