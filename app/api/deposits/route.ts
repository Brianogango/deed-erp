import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextDepositRef } from '@/lib/deposit-ref-counter'

export const dynamic = 'force-dynamic'

const STORE_KEY = 'deed_deposits_v1'

export type DepositStatus = 'active' | 'partially_paid' | 'fully_paid' | 'completed' | 'cancelled'

export interface DepositItem {
  productId: string
  productName: string
  sku: string
  qty: number
  unitPrice: number
  total: number
}

export interface DepositPayment {
  id: string
  date: string
  amount: number
  method: 'cash' | 'mpesa' | 'bank_transfer' | 'card'
  ref?: string
  recordedBy: string
}

export interface Deposit {
  id: string
  ref: string
  customerId: string
  customerName: string
  customerPhone: string
  items: DepositItem[]
  totalValue: number
  totalPaid: number
  balance: number
  status: DepositStatus
  payments: DepositPayment[]
  notes?: string
  createdAt: string
  createdBy: string
  dueDate?: string
  completedAt?: string
  cancelledAt?: string
  cancelReason?: string
}

const uid = () => crypto.randomUUID()

async function readDeposits(): Promise<Deposit[]> {
  const state = await loadAppState()
  const raw = state[STORE_KEY]
  return Array.isArray(raw) ? (raw as Deposit[]) : []
}

async function writeDeposits(deposits: Deposit[]): Promise<void> {
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(deposits) })
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const deposits = await readDeposits()
    return NextResponse.json(deposits)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    const { customerId, customerName, customerPhone, items, totalValue, dueDate, notes, initialPayment, payMethod, payRef } = body

    if (!customerId || !customerName || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'customerId, customerName and items are required' }, { status: 422 })
    }

    const deposit = Number(initialPayment) || 0
    if (deposit <= 0) {
      return NextResponse.json({ error: 'Initial deposit amount is required' }, { status: 422 })
    }

    const ref = await getNextDepositRef()
    const now = new Date().toISOString()

    const paymentHistory: DepositPayment[] = [{
      id: uid(),
      date: now,
      amount: deposit,
      method: payMethod || 'cash',
      ref: payRef || undefined,
      recordedBy: session.user.name,
    }]

    const status: DepositStatus = deposit >= totalValue ? 'fully_paid' : 'partially_paid'

    const newDeposit: Deposit = {
      id: uid(),
      ref,
      customerId,
      customerName,
      customerPhone: customerPhone || '',
      items,
      totalValue: Number(totalValue) || 0,
      totalPaid: deposit,
      balance: (Number(totalValue) || 0) - deposit,
      status,
      payments: paymentHistory,
      notes: notes || undefined,
      dueDate: dueDate || undefined,
      createdAt: now,
      createdBy: session.user.name,
    }

    const deposits = await readDeposits()
    deposits.unshift(newDeposit)
    await writeDeposits(deposits)

    return NextResponse.json(newDeposit, { status: 201 })
  })
}
