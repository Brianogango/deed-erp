import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { allocatePayment } from '@/lib/accounting/payment-allocations'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/[id]/allocations
 * Apply unallocated (outstanding) cash on an existing payment onto invoices/bills.
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

    let result
    try {
      result = await allocatePayment({
        paymentId,
        allocations,
        createdById: actor.id,
      })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Allocation failed' }, { status: 400 })
    }

    await writeFinancialAudit({
      userId: actor.id,
      action: 'allocate_outstanding_payment',
      entityType: 'payment',
      entityId: paymentId,
      newValues: {
        allocationCount: result.allocations.length,
        unallocatedAmount: result.unallocatedAmount,
        invoiceIds: allocations.map((a: { invoiceId: string; amount: number }) => a.invoiceId),
      },
    })

    try {
      const { resolveBlobInvoiceMirror } = await import('@/lib/accounting/resolve-invoice-mirror')
      const directionOutbound = String(payment.notes || '').includes('direction:outbound')
      let isVendor = directionOutbound
      const allocDetails = []
      for (const alloc of result.allocations) {
        const invoice = await prisma.invoice.findUnique({ where: { id: alloc.invoiceId } })
        if (!invoice) continue
        const mirror = await resolveBlobInvoiceMirror(invoice.id)
        if (mirror.type === 'vendor_bill') isVendor = true
        allocDetails.push({
          invoiceId: invoice.id,
          invoiceRef: invoice.invoiceNumber,
          amount: Number(alloc.amount),
          mirror,
        })
      }

      const partnerName = (() => {
        const m = String(payment.notes || '').match(/partner:([^·]+)/)
        return m ? m[1].trim() : (allocDetails[0]?.mirror.partnerName || allocDetails[0]?.mirror.clientName || 'Partner')
      })()

      if (isAccountingPostingEngineEnabled()) {
        const hadOutstandingMarker = String(payment.notes || '').includes('outstanding:')
        if (hadOutstandingMarker) {
          const { postAllocateOutstanding } = await import('@/lib/accounting/posting-service')
          await postAllocateOutstanding({
            paymentId,
            paymentRef: payment.reference || payment.id.slice(0, 8),
            partnerName,
            isVendor,
            allocations: allocDetails.map(a => ({
              invoiceId: a.invoiceId,
              invoiceRef: a.invoiceRef,
              amount: a.amount,
            })),
            createdById: actor.id,
          })
        } else {
          // Legacy under-allocation without outstanding GL — settle via bank/AR as before.
          const { postInvoicePaymentJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
          for (const a of allocDetails) {
            await postInvoicePaymentJournalToPrisma({
              invoice: {
                id: a.invoiceId,
                ref: a.invoiceRef,
                invoiceNumber: a.invoiceRef,
                type: a.mirror.type,
                purchaseOrderId: a.mirror.purchaseOrderId,
                partnerName: a.mirror.partnerName,
                clientName: a.mirror.clientName,
              },
              amount: a.amount,
              paymentId,
              method: String(payment.paymentMethod),
              createdById: actor.id,
            })
          }
        }
      } else {
        const { postInvoicePaymentJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
        for (const a of allocDetails) {
          await postInvoicePaymentJournalToPrisma({
            invoice: {
              id: a.invoiceId,
              ref: a.invoiceRef,
              invoiceNumber: a.invoiceRef,
              type: a.mirror.type,
              purchaseOrderId: a.mirror.purchaseOrderId,
              partnerName: a.mirror.partnerName,
              clientName: a.mirror.clientName,
            },
            amount: a.amount,
            paymentId,
            method: String(payment.paymentMethod),
            createdById: actor.id,
          })
        }
      }
    } catch (err) {
      console.error('[payment-allocations] journal dual-write failed:', err)
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
