import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'

export const dynamic = 'force-dynamic'

export async function POST(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()

    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deposit = deposits[idx]

    if (deposit.status !== 'fully_paid') {
      return NextResponse.json({ error: 'Only fully paid deposits can be marked as collected' }, { status: 422 })
    }

    deposits[idx] = {
      ...deposit,
      status: 'completed',
      completedAt: new Date().toISOString(),
    }

    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
