import 'server-only'
import prisma from '@/lib/prisma'
import { invoiceResidual, roundMoney } from '@/lib/accounting/money'

export function round2(n: number) {
  return roundMoney(n)
}

export { invoiceResidual }

export type AllocationInput = { invoiceId: string; amount: number }

export function validateAllocationTotals(
  paymentAmount: number,
  allocations: AllocationInput[],
  invoiceResiduals: Map<string, number>,
): { ok: true } | { ok: false; error: string } {
  const totalAllocated = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0))
  if (totalAllocated <= 0) {
    return { ok: false, error: 'At least one positive allocation is required' }
  }
  if (totalAllocated > round2(paymentAmount) + 0.01) {
    return { ok: false, error: `Allocations (${totalAllocated}) exceed payment amount (${paymentAmount})` }
  }
  for (const alloc of allocations) {
    const residual = invoiceResiduals.get(alloc.invoiceId)
    if (residual === undefined) {
      return { ok: false, error: `Invoice not found: ${alloc.invoiceId}` }
    }
    if (round2(alloc.amount) > round2(residual) + 0.01) {
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

export async function allocatePayment(opts: {
  paymentId: string
  allocations: AllocationInput[]
  createdById?: string
}) {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: opts.paymentId },
    include: { allocations: true },
  })
  if (payment.isVoided) {
    throw new Error('Cannot allocate a voided payment')
  }

  const invoiceIds = [...new Set(opts.allocations.map(a => a.invoiceId))]
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, totalAmount: true, amountPaid: true },
  })
  const invoiceMap = new Map(invoices.map(i => [i.id, i]))

  const residuals = new Map<string, number>()
  for (const invoiceId of invoiceIds) {
    const inv = invoiceMap.get(invoiceId)
    if (!inv) throw new Error(`Invoice not found: ${invoiceId}`)
    const allocated = await sumAllocationsForInvoice(invoiceId)
    residuals.set(invoiceId, invoiceResidual(Number(inv.totalAmount), allocated))
  }

  const validation = validateAllocationTotals(Number(payment.amount), opts.allocations, residuals)
  if (!validation.ok) throw new Error(validation.error)

  return prisma.$transaction(async (tx) => {
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

      const newPaid = await sumAllocationsForInvoiceInTx(tx, alloc.invoiceId)
      await tx.invoice.update({
        where: { id: alloc.invoiceId },
        data: { amountPaid: newPaid },
      })
    }
    return { payment, allocations: created }
  })
}

async function sumAllocationsForInvoiceInTx(
  tx: Pick<typeof prisma, 'paymentAllocation'>,
  invoiceId: string,
): Promise<number> {
  const rows = await tx.paymentAllocation.findMany({
    where: { invoiceId, payment: { isVoided: false } },
    select: { amount: true },
  })
  return round2(rows.reduce((s, r) => s + Number(r.amount || 0), 0))
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
  allocations: AllocationInput[]
}) {
  const invoiceIds = [...new Set(opts.allocations.map(a => a.invoiceId))]
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, totalAmount: true, amountPaid: true, status: true, paymentBlocked: true },
  })
  const invoiceMap = new Map(invoices.map(i => [i.id, i]))

  const residuals = new Map<string, number>()
  for (const invoiceId of invoiceIds) {
    const inv = invoiceMap.get(invoiceId)
    if (!inv) throw new Error(`Invoice not found: ${invoiceId}`)
    if (inv.paymentBlocked) throw new Error(`Payments blocked on invoice ${invoiceId}`)
    const allocated = await sumAllocationsForInvoice(invoiceId)
    residuals.set(invoiceId, invoiceResidual(Number(inv.totalAmount), allocated))
  }

  const validation = validateAllocationTotals(opts.amount, opts.allocations, residuals)
  if (!validation.ok) throw new Error(validation.error)

  const primaryInvoiceId = opts.invoiceId ?? invoiceIds[0] ?? null

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        ...(opts.idempotencyKey && /^[0-9a-f-]{36}$/i.test(opts.idempotencyKey)
          ? { id: opts.idempotencyKey }
          : {}),
        invoiceId: primaryInvoiceId,
        amount: round2(opts.amount),
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
      const row = await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: alloc.invoiceId,
          amount: round2(alloc.amount),
        },
      })
      allocations.push(row)

      const newPaid = await sumAllocationsForInvoiceInTx(tx, alloc.invoiceId)
      await tx.invoice.update({
        where: { id: alloc.invoiceId },
        data: { amountPaid: newPaid },
      })
    }

    return { payment, allocations }
  })
}
