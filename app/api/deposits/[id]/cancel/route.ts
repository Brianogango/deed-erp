import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { Deposit } from '../../route'

export const dynamic = 'force-dynamic'

const STORE_KEY = 'deed_deposits_v1'

async function readDeposits(): Promise<Deposit[]> {
  const state = await loadAppState()
  const raw = state[STORE_KEY]
  return Array.isArray(raw) ? (raw as Deposit[]) : []
}

async function writeDeposits(deposits: Deposit[]): Promise<void> {
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(deposits) })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
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
