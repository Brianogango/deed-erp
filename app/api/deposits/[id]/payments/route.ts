import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { Deposit, DepositPayment, DepositStatus } from '../../route'

export const dynamic = 'force-dynamic'

const STORE_KEY = 'deed_deposits_v1'

const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase()

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
    const session = await getRequiredSession()
    const body = await request.json()

    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deposit = deposits[idx]

    if (!['active', 'partially_paid'].includes(deposit.status)) {
      return NextResponse.json({ error: 'Cannot add payment to a deposit in this status' }, { status: 422 })
    }

    const amount = Math.min(Number(body.amount) || 0, deposit.balance)
    if (amount <= 0) {
      return NextResponse.json({ error: 'Payment amount must be greater than 0' }, { status: 422 })
    }

    const payment: DepositPayment = {
      id: uid(),
      date: new Date().toISOString(),
      amount,
      method: body.method || 'cash',
      ref: body.ref || undefined,
      recordedBy: session.user.name,
    }

    const newTotalPaid = deposit.totalPaid + amount
    const newBalance = deposit.balance - amount
    const newStatus: DepositStatus = newBalance <= 0 ? 'fully_paid' : 'partially_paid'

    deposits[idx] = {
      ...deposit,
      totalPaid: newTotalPaid,
      balance: newBalance,
      status: newStatus,
      payments: [...deposit.payments, payment],
    }

    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
