import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { recordPaymentWithAllocations } from '@/lib/accounting/payment-allocations'
import { paymentAllocatedSum, paymentUnallocated } from '@/lib/accounting/residuals'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Payment } from '@/lib/store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { roundMoney } from '@/lib/accounting/money'

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
  const outstandingOnly = request.nextUrl.searchParams.get('outstanding') === '1'
    || request.nextUrl.searchParams.get('outstanding') === 'true'
  if (!outstandingOnly) {
    return blobHandlers.GET(request)
  }

  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const payments = await prisma.payment.findMany({
      where: { isVoided: false },
      include: { allocations: true },
      orderBy: { paidAt: 'desc' },
      take: 500,
    })
    const rows = payments
      .map(p => {
        const allocatedSum = paymentAllocatedSum(
          p.allocations.map(a => ({ amount: Number(a.amount) })),
        )
        const unallocatedAmount = paymentUnallocated(Number(p.amount), allocatedSum)
        return { ...p, allocatedSum, unallocatedAmount }
      })
      .filter(p => p.unallocatedAmount > 0.009)
    return NextResponse.json({ payments: rows })
  })
}

export async function POST(request: NextRequest) {
  const cloned = request.clone()
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer', 'admin_officer'])
    const body = await request.json().catch(() => ({}))

    const hasAllocationsKey = Array.isArray(body.allocations)
    const outstandingFlag = Boolean(body.outstanding)

    // Legacy blob path when caller does not send allocations / outstanding.
    if (!hasAllocationsKey && !outstandingFlag) {
      return blobHandlers.POST(cloned as NextRequest)
    }

    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : (body.date ? new Date(String(body.date)) : new Date())
    const lock = await checkFiscalLock(paidAt)
    if (!lock.ok) {
      return NextResponse.json({ error: lock.error }, { status: lock.status })
    }

    const allocations = hasAllocationsKey
      ? body.allocations.map((a: { invoiceId?: string; amount?: number }) => ({
          invoiceId: String(a.invoiceId || ''),
          amount: Number(a.amount || 0),
        })).filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)
      : []

    const amount = Number(body.amount)
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const totalAllocated = roundMoney(
      allocations.reduce((s: number, a: { amount: number }) => s + a.amount, 0),
    )
    if (totalAllocated > amount + 0.01) {
      return NextResponse.json({
        error: `Sum of allocations (${totalAllocated}) exceeds payment amount (${amount})`,
      }, { status: 400 })
    }

    if (allocations.length === 0 && !outstandingFlag && hasAllocationsKey) {
      // Empty allocations array is treated as a fully outstanding receipt/payment.
    }

    const paymentMethod = String(body.paymentMethod || body.method || 'cash')
    const reference = body.reference ? String(body.reference) : null
    const notes = body.notes ? String(body.notes) : null
    const mpesaPhone = body.mpesaPhone ? String(body.mpesaPhone) : null
    const partnerName = body.partnerName || body.customerName
      ? String(body.partnerName || body.customerName)
      : null
    const direction = String(body.direction || 'inbound').toLowerCase() === 'outbound'
      ? 'outbound'
      : 'inbound'
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
        const allocatedSum = paymentAllocatedSum(
          existing.allocations.map(a => ({ amount: Number(a.amount) })),
        )
        return NextResponse.json({
          payment: existing,
          allocations: existing.allocations,
          unallocatedAmount: paymentUnallocated(Number(existing.amount), allocatedSum),
          idempotent: true,
        })
      }
    }

    const unallocatedPreview = paymentUnallocated(amount, totalAllocated)
    const noteParts = [
      notes,
      idempotencyKey ? `idempotency:${idempotencyKey}` : null,
      partnerName ? `partner:${partnerName}` : null,
      `direction:${direction}`,
      unallocatedPreview > 0.009 ? (totalAllocated > 0 ? 'outstanding:partial' : 'outstanding:full') : null,
    ].filter(Boolean)

    const { payment, allocations: createdAllocations, unallocatedAmount } =
      await recordPaymentWithAllocations({
        amount,
        paymentMethod,
        reference,
        paidAt,
        notes: noteParts.join(' · ') || null,
        mpesaPhone,
        createdById: actor.id,
        invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
        idempotencyKey,
        allocations,
        allowUnallocated: true,
      })

    await writeFinancialAudit({
      userId: actor.id,
      action: unallocatedAmount > 0.009
        ? 'record_outstanding_payment'
        : 'record_multi_invoice_payment',
      entityType: 'payment',
      entityId: payment.id,
      newValues: {
        amount,
        paymentMethod,
        allocationCount: createdAllocations.length,
        unallocatedAmount,
        invoiceIds: allocations.map((a: { invoiceId: string }) => a.invoiceId),
        direction,
      },
    })

    try {
      if (isAccountingPostingEngineEnabled()) {
        const { postPaymentWithOutstanding } = await import('@/lib/accounting/posting-service')
        const { resolveBlobInvoiceMirror } = await import('@/lib/accounting/resolve-invoice-mirror')
        const allocDetails = []
        let isVendor = direction === 'outbound'
        for (const alloc of createdAllocations) {
          const invoice = await prisma.invoice.findUnique({ where: { id: alloc.invoiceId } })
          if (!invoice) continue
          const mirror = await resolveBlobInvoiceMirror(invoice.id)
          if (mirror.type === 'vendor_bill') isVendor = true
          allocDetails.push({
            invoiceId: invoice.id,
            invoiceRef: invoice.invoiceNumber,
            amount: Number(alloc.amount),
          })
        }
        await postPaymentWithOutstanding({
          paymentId: payment.id,
          paymentRef: reference || payment.id.slice(0, 8),
          partnerName: partnerName || 'Partner',
          method: paymentMethod,
          isVendor,
          allocations: allocDetails,
          unallocatedAmount,
          createdById: actor.id,
        })
      } else {
        const { postInvoicePaymentJournalToPrisma } = await import('@/lib/accounting/invoice-journals')
        const { resolveBlobInvoiceMirror } = await import('@/lib/accounting/resolve-invoice-mirror')
        for (const alloc of createdAllocations) {
          const invoice = await prisma.invoice.findUnique({ where: { id: alloc.invoiceId } })
          if (!invoice) continue
          const mirror = await resolveBlobInvoiceMirror(invoice.id)
          await postInvoicePaymentJournalToPrisma({
            invoice: {
              id: invoice.id,
              ref: invoice.invoiceNumber,
              invoiceNumber: invoice.invoiceNumber,
              totalAmount: Number(invoice.totalAmount),
              type: mirror.type,
              purchaseOrderId: mirror.purchaseOrderId,
              partnerName: mirror.partnerName,
              clientName: mirror.clientName,
            },
            amount: Number(alloc.amount),
            paymentId: payment.id,
            method: paymentMethod,
            createdById: actor.id,
          })
        }
      }
    } catch (err) {
      console.error('[payments] journal dual-write failed:', err)
    }

    try {
      const { notifyCustomerPaymentReceived } = await import('@/lib/finance/payment-receipt-notify')
      for (const alloc of createdAllocations) {
        await notifyCustomerPaymentReceived({
          invoiceId: alloc.invoiceId,
          paymentId: payment.id,
          amount: Number(alloc.amount),
          paymentMethod,
          reference,
          paidAt: payment.paidAt ?? paidAt,
          actorUserId: actor.id,
          actorName: actor.name || actor.username || null,
        })
      }
    } catch (err) {
      console.error('[payments] receipt notify failed:', err)
    }

    return NextResponse.json({
      payment,
      allocations: createdAllocations,
      unallocatedAmount,
    })
  })
}
