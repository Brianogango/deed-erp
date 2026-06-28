import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))

    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deposit = deposits[idx]

    if (['completed', 'cancelled'].includes(deposit.status)) {
      return NextResponse.json({ error: 'Cannot cancel a deposit in this status' }, { status: 422 })
    }

    deposits[idx] = {
      ...deposit,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: body.reason || undefined,
    }

    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
