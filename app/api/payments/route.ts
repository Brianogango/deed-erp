import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { recordPaymentWithAllocations } from '@/lib/accounting/payment-allocations'
import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Payment } from '@/lib/store'

const blobConfig = {
  storeKey: 'deed_payments',
  allowedWriteRoles: ['director', 'finance_officer', 'admin_officer'],
  build: (body: Record<string, unknown>): Payment | string => {
    if (!body.customerId) return 'customerId is required'
    return { ...body } as unknown as Payment
  },
}

const blobHandlers = makeCollectionHandlers(blobConfig)

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return blobHandlers.GET(request)
}

export async function POST(request: NextRequest) {
  const cloned = request.clone()
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer', 'admin_officer'])
    const body = await request.json().catch(() => ({}))

    const allocations = Array.isArray(body.allocations)
      ? body.allocations.map((a: { invoiceId?: string; amount?: number }) => ({
          invoiceId: String(a.invoiceId || ''),
          amount: Number(a.amount || 0),
        })).filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)
      : []

    if (allocations.length === 0) {
      return blobHandlers.POST(cloned as NextRequest)
    }

    const amount = Number(body.amount)
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const totalAllocated = allocations.reduce((s: number, a: { amount: number }) => s + a.amount, 0)
    if (Math.abs(totalAllocated - amount) > 0.02) {
      return NextResponse.json({ error: 'Sum of allocations must equal payment amount' }, { status: 400 })
    }

    const paymentMethod = String(body.paymentMethod || body.method || 'cash')
    const reference = body.reference ? String(body.reference) : null
    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date()
    const notes = body.notes ? String(body.notes) : null
    const mpesaPhone = body.mpesaPhone ? String(body.mpesaPhone) : null
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined

    if (idempotencyKey) {
      const existing = await prisma.payment.findFirst({
        where: {
          isVoided: false,
          OR: [
            { id: idempotencyKey },
            { reference: idempotencyKey },
            { notes: { contains: `idempotency:${idempotencyKey}` } },
          ],
        },
        include: { allocations: true },
      })
      if (existing) {
        return NextResponse.json({ payment: existing, allocations: existing.allocations, idempotent: true })
      }
    }

    const { payment, allocations: createdAllocations } = await recordPaymentWithAllocations({
      amount,
      paymentMethod,
      reference,
      paidAt,
      notes: [
        notes,
        idempotencyKey ? `idempotency:${idempotencyKey}` : null,
      ].filter(Boolean).join(' · ') || null,
      mpesaPhone,
      createdById: actor.id,
      invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
      idempotencyKey,
      allocations,
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'record_multi_invoice_payment',
      entityType: 'payment',
      entityId: payment.id,
      newValues: {
        amount,
        paymentMethod,
        allocationCount: createdAllocations.length,
        invoiceIds: allocations.map((a: { invoiceId: string }) => a.invoiceId),
      },
    })

    try {
      const { postInvoicePaymentJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
      for (const alloc of createdAllocations) {
        const invoice = await prisma.invoice.findUnique({ where: { id: alloc.invoiceId } })
        if (!invoice) continue
        await postInvoicePaymentJournalToPrisma({
          invoice: {
            id: invoice.id,
            ref: invoice.invoiceNumber,
            invoiceNumber: invoice.invoiceNumber,
            totalAmount: Number(invoice.totalAmount),
            type: 'customer_invoice',
          },
          amount: Number(alloc.amount),
          paymentId: payment.id,
          method: paymentMethod,
          createdById: actor.id,
        })
      }
    } catch (err) {
      console.error('[payments] journal dual-write failed:', err)
    }

    return NextResponse.json({ payment, allocations: createdAllocations })
  })
}
