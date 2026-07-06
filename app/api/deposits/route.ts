import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'
import { getNextDepositRef } from '@/lib/deposit-ref-counter'
import { writeFinancialAudit } from '@/lib/finance-audit'

const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']

export const dynamic = 'force-dynamic'

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

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const deposits = await readDeposits()
    return NextResponse.json(deposits)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(DEPOSIT_WRITE_ROLES)
    const body = await request.json()

    const { customerId, customerName, customerPhone, items, dueDate, notes, initialPayment, payMethod, payRef } = body

    if (!customerId || !customerName || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'customerId, customerName and items are required' }, { status: 422 })
    }

    // Total value is recomputed from line items server-side — never trusted from
    // the client — so a deposit's balance always ties back to what was ordered.
    const normalizedItems: DepositItem[] = items.map((it: any) => {
      const qty = Number(it.qty) || 0
      const unitPrice = Number(it.unitPrice) || 0
      return {
        productId: String(it.productId ?? ''),
        productName: String(it.productName ?? ''),
        sku: String(it.sku ?? ''),
        qty,
        unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100,
      }
    })
    const totalValue = Math.round(normalizedItems.reduce((sum, it) => sum + it.total, 0) * 100) / 100

    const deposit = Number(initialPayment) || 0
    if (deposit <= 0) {
      return NextResponse.json({ error: 'Initial deposit amount is required' }, { status: 422 })
    }
    if (deposit > totalValue) {
      return NextResponse.json({ error: 'Initial deposit cannot exceed the order total' }, { status: 422 })
    }

    const ref = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim() : await getNextDepositRef()
    const now = new Date().toISOString()

    const paymentHistory: DepositPayment[] = [{
      id: uid(),
      date: now,
      amount: deposit,
      method: payMethod || 'cash',
      ref: payRef || undefined,
      recordedBy: actor.name,
    }]

    const status: DepositStatus = deposit >= totalValue ? 'fully_paid' : 'partially_paid'

    const newDeposit: Deposit = {
      id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : uid(),
      ref,
      customerId,
      customerName,
      customerPhone: customerPhone || '',
      items: normalizedItems,
      totalValue,
      totalPaid: deposit,
      balance: Math.round((totalValue - deposit) * 100) / 100,
      status,
      payments: paymentHistory,
      notes: notes || undefined,
      dueDate: dueDate || undefined,
      createdAt: now,
      createdBy: actor.name,
    }

    const deposits = await readDeposits()
    deposits.unshift(newDeposit)
    await writeDeposits(deposits)

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_deposit',
      entityType: 'deposit',
      newValues: { ref, totalValue, initialPayment: deposit },
    })

    return NextResponse.json(newDeposit, { status: 201 })
  })
}
