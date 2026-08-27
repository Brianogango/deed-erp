import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { recordPaymentWithAllocations } from '@/lib/accounting/payment-allocations'
import { paymentAllocatedSum, paymentUnallocated } from '@/lib/accounting/residuals'
import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Payment } from '@/lib/store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { roundMoney } from '@/lib/accounting/money'
import {
  buildPaymentWithOutstandingLines,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'

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

    const postingLines = buildPaymentWithOutstandingLines({
      partnerName: partnerName || 'Partner',
      paymentRef: reference || 'receipt',
      method: paymentMethod,
      isVendor: direction === 'outbound',
      allocations: allocations.map((a: { invoiceId: string; amount: number }) => ({
        invoiceRef: a.invoiceId,
        amount: a.amount,
      })),
      unallocatedAmount: unallocatedPreview,
    })

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
        journal: postingLines.length
          ? paymentId => ({
              ref: `JRN/PAY/${reference || paymentId.slice(0, 8)}/${paymentId}`.slice(0, 80),
              journalCode: direction === 'outbound' ? 'PUR' : (String(paymentMethod).toLowerCase() === 'cash' ? 'CSH' : 'BNK'),
              date: paidAt,
              description: `Payment ${reference || paymentId.slice(0, 8)} — ${partnerName || 'Partner'}`,
              sourceType: direction === 'outbound' ? 'purchase_payment' : 'payment',
              sourceId: paymentId,
              paymentId,
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
            action: unallocatedPreview > 0.009
              ? 'record_outstanding_payment'
              : 'record_multi_invoice_payment',
            entityType: 'payment',
            entityId: pay.id,
            newValues: {
              amount,
              paymentMethod,
              allocationCount: created.length,
              unallocatedAmount: unallocatedPreview,
              invoiceIds: allocations.map((a: { invoiceId: string }) => a.invoiceId),
              direction,
            },
          })
        },
      })

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
