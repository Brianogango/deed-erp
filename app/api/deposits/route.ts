import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import prisma from '@/lib/prisma'
import { getNextDepositRef } from '@/lib/deposit-ref-counter'
import { createDepositWithReceipt } from '@/lib/accounting/deposit-service'
import { z } from 'zod'

const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']
export const dynamic = 'force-dynamic'

const depositCreateSchema = z.object({
  customerId: z.string().trim().min(1).max(80),
  customerName: z.string().trim().min(1).max(200),
  customerPhone: z.string().trim().max(50).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(80),
    productName: z.string().trim().min(1).max(240),
    sku: z.string().trim().max(120).optional().nullable(),
    qty: z.coerce.number().int().positive().max(1_000_000),
    unitPrice: z.coerce.number().finite().nonnegative().max(9_999_999_999.99),
    total: z.coerce.number().finite().nonnegative().optional(),
  }).strict()).min(1).max(500),
  initialPayment: z.coerce.number().finite().positive().max(9_999_999_999.99),
  payMethod: z.enum(['cash', 'mpesa', 'bank_transfer', 'card']).default('cash'),
  payRef: z.string().trim().max(160).optional().nullable(),
  bankAccountId: z.string().trim().max(80).optional().nullable(),
  idempotencyKey: z.string().trim().max(160).optional().nullable(),
  dueDate: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(10_000).optional().nullable(),

  // Legacy UI sends these optimistic fields. They are accepted only for
  // compatibility and never persisted as authoritative values.
  id: z.string().max(80).optional(),
  ref: z.string().max(80).optional(),
  totalValue: z.coerce.number().finite().nonnegative().optional(),
}).strict()

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
    const parsed = depositCreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid deposit request', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 422 },
      )
    }
    const body = parsed.data
    const dueDate = body.dueDate ? new Date(body.dueDate) : null
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: 'Invalid deposit due date' }, { status: 422 })
    }

    // Identity/reference and all totals/status/posting fields are server-owned.
    const ref = await getNextDepositRef()
    const row = await createDepositWithReceipt({
      ref,
      customerId: body.customerId,
      customerName: body.customerName,
      customerPhone: body.customerPhone || undefined,
      items: body.items.map(x => ({
        productId: x.productId,
        productName: x.productName,
        sku: x.sku || undefined,
        qty: x.qty,
        unitPrice: x.unitPrice,
      })),
      amount: body.initialPayment,
      method: body.payMethod,
      paymentRef: body.payRef || null,
      bankAccountId: body.bankAccountId || null,
      idempotencyKey: body.idempotencyKey || null,
      dueDate,
      notes: body.notes || null,
      actor: { id: actor.id, name: actor.name },
    })
    return NextResponse.json(toClient(row), { status: 201 })
  })
}
