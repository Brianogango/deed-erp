import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { invoiceResidual, roundMoney } from '@/lib/accounting/money'
import { createJournalEntryInTx, type CreateJournalEntryInput } from '@/lib/accounting/journal-service'
import {
  paymentAllocatedSum,
  paymentUnallocated,
} from '@/lib/accounting/residuals'

export function round2(n: number) {
  return roundMoney(n)
}

export { invoiceResidual, paymentAllocatedSum, paymentUnallocated }

function isRetryableTxn(err: unknown) {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return code === 'P2034' || /write conflict|deadlock|could not serialize/i.test(msg)
}

function taggedError(message: string, status = 409): Error {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' })
    } catch (err) {
      last = err
      if (!isRetryableTxn(err) || attempt === 2) throw err
    }
  }
  throw last
}

export type AllocationInput = { invoiceId: string; amount: number }

export type ValidateAllocationOptions = {
  allowEmpty?: boolean
  allocationCeiling?: number
}

export function validateAllocationTotals(
  paymentAmount: number,
  allocations: AllocationInput[],
  invoiceResiduals: Map<string, number>,
  opts?: ValidateAllocationOptions,
): { ok: true } | { ok: false; error: string } {
  const payment = round2(paymentAmount)
  if (payment <= 0) return { ok: false, error: 'Payment amount must be positive' }

  for (const alloc of allocations) {
    const amount = round2(alloc.amount)
    if (amount <= 0) {
      return { ok: false, error: `Allocation for invoice ${alloc.invoiceId} must be greater than zero` }
    }
  }

  const totalAllocated = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0))
  if (totalAllocated <= 0) {
    if (opts?.allowEmpty && payment > 0) return { ok: true }
    return { ok: false, error: 'At least one positive allocation is required' }
  }
  const ceiling = round2(opts?.allocationCeiling ?? paymentAmount)
  if (totalAllocated > ceiling + 0.009) {
    return {
      ok: false,
      error: `Allocations (${totalAllocated}) exceed available amount (${ceiling})`,
    }
  }
  for (const alloc of allocations) {
    const residual = invoiceResiduals.get(alloc.invoiceId)
    if (residual === undefined) {
      return { ok: false, error: `Invoice not found: ${alloc.invoiceId}` }
    }
    if (round2(alloc.amount) > round2(residual) + 0.009) {
      return { ok: false, error: `Allocation for invoice ${alloc.invoiceId} exceeds residual (${residual})` }
    }
  }
  return { ok: true }
}

export async function sumAllocationsForInvoice(invoiceId: string): Promise<number> {
  const rows = await prisma.paymentAllocation.findMany({
    where: { invoiceId, payment: { isVoided: false } },
    select: { amount: true },
  })
  return round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0))
}

export async function sumAllocationsForPayment(paymentId: string): Promise<number> {
  const rows = await prisma.paymentAllocation.findMany({
    where: { paymentId, payment: { isVoided: false } },
    select: { amount: true },
  })
  return round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0))
}

async function sumAllocationsForInvoiceInTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<number> {
  const rows = await tx.paymentAllocation.findMany({
    where: { invoiceId, payment: { isVoided: false } },
    select: { amount: true },
  })
  return round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0))
}

async function sumAllocationsForPaymentInTx(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<number> {
  const rows = await tx.paymentAllocation.findMany({
    where: { paymentId, payment: { isVoided: false } },
    select: { amount: true },
  })
  return round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0))
}

export async function allocatePayment(opts: {
  paymentId: string
  allocations: AllocationInput[]
  createdById?: string
  journal?: (paymentId: string, created: Array<{ invoiceId: string; amount: unknown }>) => CreateJournalEntryInput
  audit?: (tx: Prisma.TransactionClient, payment: any, created: any[]) => Promise<void>
}) {
  return runSerializable(async tx => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: opts.paymentId },
      include: { allocations: true },
    })
    if (payment.isVoided) throw taggedError('Cannot allocate a voided payment')

    const alreadyAllocated = await sumAllocationsForPaymentInTx(tx, payment.id)
    const available = paymentUnallocated(Number(payment.amount), alreadyAllocated)
    if (available <= 0.009) throw taggedError('Payment has no unallocated amount remaining')

    const invoiceIds = [...new Set(opts.allocations.map(a => a.invoiceId))]
    const invoices = await tx.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, totalAmount: true, paymentBlocked: true, invoiceNumber: true },
    })
    const invoiceMap = new Map(invoices.map(i => [i.id, i]))
    const residuals = new Map<string, number>()

    for (const invoiceId of invoiceIds) {
      const inv = invoiceMap.get(invoiceId)
      if (!inv) throw taggedError(`Invoice not found: ${invoiceId}`, 404)
      if (inv.paymentBlocked) throw taggedError(`Payments blocked on invoice ${invoiceId}`)
      const allocated = await sumAllocationsForInvoiceInTx(tx, invoiceId)
      residuals.set(invoiceId, invoiceResidual(Number(inv.totalAmount), allocated))
    }

    const validation = validateAllocationTotals(
      Number(payment.amount),
      opts.allocations,
      residuals,
      { allocationCeiling: available },
    )
    if (!validation.ok) throw taggedError(validation.error)

    const created = []
    for (const alloc of opts.allocations) {
      const row = await tx.paymentAllocation.create({
        data: {
          paymentId: opts.paymentId,
          invoiceId: alloc.invoiceId,
          amount: round2(alloc.amount),
        },
      })
      created.push(row)
    }

    for (const invoiceId of invoiceIds) {
      const newPaid = await sumAllocationsForInvoiceInTx(tx, invoiceId)
      await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: newPaid } })
    }

    if (opts.journal) {
      const journal = await createJournalEntryInTx(tx, opts.journal(payment.id, created))
      await tx.payment.update({
        where: { id: payment.id },
        data: { journalId: journal.id, postingStatus: 'posted' },
      })
    }
    if (opts.audit) {
      await opts.audit(tx, payment, created)
    }

    const newAllocated = await sumAllocationsForPaymentInTx(tx, payment.id)
    return {
      payment,
      allocations: created,
      unallocatedAmount: paymentUnallocated(Number(payment.amount), newAllocated),
    }
  })
}

export async function recordPaymentWithAllocations(opts: {
  amount: number
  paymentMethod: string
  reference?: string | null
  paidAt?: Date
  notes?: string | null
  mpesaPhone?: string | null
  createdById: string
  invoiceId?: string | null
  idempotencyKey?: string
  paymentType?: string
  partnerId?: string | null
  bankAccountId?: string | null
  journalId?: string | null
  currencyCode?: string
  exchangeRateToBase?: number
  externalReference?: string | null
  allocations: AllocationInput[]
  allowUnallocated?: boolean
  journal?: (paymentId: string) => CreateJournalEntryInput
  audit?: (tx: Prisma.TransactionClient, payment: any, allocations: any[]) => Promise<void>
}) {
  return runSerializable(async tx => {
    if (opts.idempotencyKey) {
      const existing = await tx.payment.findFirst({
        where: {
          isVoided: false,
          OR: [
            ...( /^[0-9a-f-]{36}$/i.test(opts.idempotencyKey) ? [{ id: opts.idempotencyKey }] : [] ),
            { reference: opts.idempotencyKey },
            { notes: { contains: `idempotency:${opts.idempotencyKey}` } },
          ],
        },
        include: { allocations: true },
      })
      if (existing) {
        const allocated = paymentAllocatedSum(existing.allocations.map(a => ({ amount: Number(a.amount) })))
        return {
          payment: existing,
          allocations: existing.allocations,
          unallocatedAmount: paymentUnallocated(Number(existing.amount), allocated),
          idempotent: true as const,
        }
      }
    }

    const invoiceIds = [...new Set(opts.allocations.map(a => a.invoiceId))]
    const invoices = invoiceIds.length
      ? await tx.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, totalAmount: true, status: true, paymentBlocked: true },
        })
      : []
    const invoiceMap = new Map(invoices.map(i => [i.id, i]))
    const residuals = new Map<string, number>()

    for (const invoiceId of invoiceIds) {
      const inv = invoiceMap.get(invoiceId)
      if (!inv) throw taggedError(`Invoice not found: ${invoiceId}`, 404)
      if (inv.paymentBlocked) throw taggedError(`Payments blocked on invoice ${invoiceId}`)
      const allocated = await sumAllocationsForInvoiceInTx(tx, invoiceId)
      residuals.set(invoiceId, invoiceResidual(Number(inv.totalAmount), allocated))
    }

    const validation = validateAllocationTotals(opts.amount, opts.allocations, residuals, {
      allowEmpty: Boolean(opts.allowUnallocated),
    })
    if (!validation.ok) throw taggedError(validation.error)

    const primaryInvoiceId = opts.invoiceId ?? invoiceIds[0] ?? null
    const payment = await tx.payment.create({
      data: {
        ...(opts.idempotencyKey && /^[0-9a-f-]{36}$/i.test(opts.idempotencyKey)
          ? { id: opts.idempotencyKey }
          : {}),
        invoiceId: primaryInvoiceId,
        amount: round2(opts.amount),
        amountBase: round2(opts.amount * (opts.exchangeRateToBase ?? 1)),
        paymentType: opts.paymentType ?? 'customer_receipt',
        partnerId: opts.partnerId ?? null,
        bankAccountId: opts.bankAccountId ?? null,
        journalId: opts.journalId ?? null,
        currencyCode: opts.currencyCode ?? 'KES',
        exchangeRateToBase: opts.exchangeRateToBase ?? 1,
        externalReference: opts.externalReference ?? opts.reference ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        reconciliationStatus: 'unreconciled',
        postingStatus: opts.journal ? 'posted' : 'unposted',
        paymentMethod: opts.paymentMethod as any,
        reference: opts.reference ?? null,
        mpesaPhone: opts.mpesaPhone ?? null,
        paidAt: opts.paidAt ?? new Date(),
        notes: opts.notes ?? null,
        createdById: opts.createdById,
      },
    })

    const allocations = []
    for (const alloc of opts.allocations) {
      allocations.push(await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: alloc.invoiceId,
          amount: round2(alloc.amount),
        },
      }))
    }

    for (const invoiceId of invoiceIds) {
      const newPaid = await sumAllocationsForInvoiceInTx(tx, invoiceId)
      const inv = invoiceMap.get(invoiceId)!
      if (newPaid > round2(Number(inv.totalAmount)) + 0.009) {
        throw taggedError(`Concurrent allocation would overpay invoice ${invoiceId}`)
      }
      await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: newPaid } })
    }

    if (opts.journal) {
      const journal = await createJournalEntryInTx(tx, opts.journal(payment.id))
      await tx.payment.update({
        where: { id: payment.id },
        data: { journalId: journal.id, postingStatus: 'posted' },
      })
    }
    if (opts.audit) {
      await opts.audit(tx, payment, allocations)
    }

    const allocatedSum = paymentAllocatedSum(allocations.map(a => ({ amount: Number(a.amount) })))
    return {
      payment,
      allocations,
      unallocatedAmount: paymentUnallocated(opts.amount, allocatedSum),
      idempotent: false as const,
    }
  })
}
