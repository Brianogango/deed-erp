import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import prisma from '@/lib/prisma'
import { getNextDepositRef } from '@/lib/deposit-ref-counter'
import { createDepositWithReceipt } from '@/lib/accounting/deposit-service'

const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']
export const dynamic = 'force-dynamic'

function toClient(d: any) {
  return {
    id: d.id,
    ref: d.ref,
    customerId: d.customerId ?? '',
    customerName: d.customerName ?? '',
    customerPhone: d.customerPhone ?? '',
    items: (d.items ?? []).map((x: any) => ({
      id: x.id,
      productId: x.productId ?? '',
      productName: x.productName ?? '',
      sku: x.sku ?? '',
      qty: x.qty,
      unitPrice: Number(x.unitPrice),
      total: Number(x.lineTotal),
    })),
    totalValue: Number(d.totalValue),
    totalPaid: Number(d.totalPaid),
    balance: Number(d.balance),
    status: d.status,
    payments: (d.payments ?? []).map((p: any) => ({
      id: p.id,
      date: p.paidAt.toISOString(),
      amount: Number(p.amount),
      method: p.method,
      ref: p.paymentRef ?? undefined,
      recordedBy: p.recordedBy ?? '',
    })),
    notes: d.notes ?? undefined,
    dueDate: d.dueDate?.toISOString().slice(0,10),
    completedAt: d.completedAt?.toISOString(),
    cancelledAt: d.cancelledAt?.toISOString(),
    cancelReason: d.cancelReason ?? undefined,
    createdAt: d.createdAt.toISOString(),
    createdBy: d.createdBy ?? '',
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const rows = await prisma.deposit.findMany({
      include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paidAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(rows.map(toClient))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(DEPOSIT_WRITE_ROLES)
    const body = await request.json()
    const { customerId, customerName, customerPhone, items, dueDate, notes, initialPayment, payMethod, payRef, bankAccountId, idempotencyKey } = body
    if (!customerId || !customerName || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'customerId, customerName and items are required' }, { status: 422 })
    }
    const ref = typeof body.ref === 'string' && body.ref.trim()
      ? body.ref.trim()
      : await getNextDepositRef()
    const row = await createDepositWithReceipt({
      id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined,
      ref,
      customerId: String(customerId),
      customerName: String(customerName),
      customerPhone: customerPhone ? String(customerPhone) : undefined,
      items: items.map((x:any) => ({
        productId: String(x.productId ?? ''),
        productName: String(x.productName ?? ''),
        sku: x.sku ? String(x.sku) : undefined,
        qty: Number(x.qty),
        unitPrice: Number(x.unitPrice),
      })),
      amount: Number(initialPayment),
      method: String(payMethod || 'cash'),
      paymentRef: payRef ? String(payRef) : null,
      bankAccountId: bankAccountId ? String(bankAccountId) : null,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes ? String(notes) : null,
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json(toClient(row), { status: 201 })
  })
}
