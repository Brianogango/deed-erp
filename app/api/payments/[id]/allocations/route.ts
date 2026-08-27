import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { allocatePayment } from '@/lib/accounting/payment-allocations'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import {
  buildAllocateOutstandingLines,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/[id]/allocations
 * Apply unallocated (outstanding) cash on an existing payment onto invoices/bills.
 * Journal + audit commit in the same SERIALIZABLE transaction as the allocations.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer', 'admin_officer'])
    const paymentId = params.id
    const body = await request.json().catch(() => ({}))

    const allocations = Array.isArray(body.allocations)
      ? body.allocations.map((a: { invoiceId?: string; amount?: number }) => ({
          invoiceId: String(a.invoiceId || ''),
          amount: Number(a.amount || 0),
        })).filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)
      : []

    if (allocations.length === 0) {
      return NextResponse.json({ error: 'At least one positive allocation is required' }, { status: 400 })
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    if (payment.isVoided) {
      return NextResponse.json({ error: 'Cannot allocate a voided payment' }, { status: 409 })
    }

    const lock = await checkFiscalLock(new Date())
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const invoices = await prisma.invoice.findMany({
      where: { id: { in: allocations.map((a: { invoiceId: string }) => a.invoiceId) } },
      select: { id: true, invoiceNumber: true },
    })
    const invoiceRef = new Map(invoices.map(i => [i.id, i.invoiceNumber]))
    const directionOutbound = String(payment.notes || '').includes('direction:outbound')
    const partnerName = (() => {
      const m = String(payment.notes || '').match(/partner:([^·]+)/)
      return m ? m[1].trim() : 'Partner'
    })()
    const postingLines = buildAllocateOutstandingLines({
      partnerName,
      paymentRef: payment.reference || payment.id.slice(0, 8),
      isVendor: directionOutbound,
      allocations: allocations.map((a: { invoiceId: string; amount: number }) => ({
        invoiceRef: invoiceRef.get(a.invoiceId) || a.invoiceId,
        amount: a.amount,
      })),
    })

    let result
    try {
      result = await allocatePayment({
        paymentId,
        allocations,
        createdById: actor.id,
        journal: postingLines.length
          ? (payId) => ({
              ref: `JRN/PAYALC/${payment.reference || payId.slice(0, 8)}/${Date.now().toString(36)}`.slice(0, 80),
              journalCode: directionOutbound ? 'PUR' : 'BNK',
              date: new Date(),
              description: `Allocate outstanding ${payment.reference || payId.slice(0, 8)} — ${partnerName}`,
              sourceType: directionOutbound ? 'purchase_payment' : 'payment',
              sourceId: payId,
              paymentId: payId,
              invoiceId: allocations[0]?.invoiceId ?? null,
              createdById: actor.id,
              skipIfExists: false,
              lines: postingLines.map(l => ({
                accountLabel: resolvePostingAccountLabel(l),
                label: l.description,
                debit: Number(l.debit || 0),
                credit: Number(l.credit || 0),
              })),
            })
          : undefined,
        audit: async (tx, pay, created) => {
          await writeFinancialAuditInTx(tx, {
            userId: actor.id,
            action: 'allocate_outstanding_payment',
            entityType: 'payment',
            entityId: pay.id,
            newValues: {
              allocationCount: created.length,
              invoiceIds: allocations.map((a: { invoiceId: string }) => a.invoiceId),
            },
          })
        },
      })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Allocation failed' }, { status: 400 })
    }

    try {
      const { notifyCustomerPaymentReceived } = await import('@/lib/finance/payment-receipt-notify')
      for (const alloc of result.allocations) {
        await notifyCustomerPaymentReceived({
          invoiceId: alloc.invoiceId,
          paymentId,
          amount: Number(alloc.amount),
          paymentMethod: String(payment.paymentMethod),
          reference: payment.reference,
          paidAt: payment.paidAt ?? new Date(),
          actorUserId: actor.id,
          actorName: actor.name || actor.username || null,
        })
      }
    } catch (err) {
      console.error('[payment-allocations] receipt notify failed:', err)
    }

    return NextResponse.json({
      payment: result.payment,
      allocations: result.allocations,
      unallocatedAmount: result.unallocatedAmount,
    })
  })
}
