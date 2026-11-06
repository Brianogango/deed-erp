import 'server-only'
import { createHash, randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { computeInvoiceLineMoney, computeInvoiceTotals } from '@/lib/finance-invoice'
import { updateDeliveryJob } from './rider-portal.server'
import { deliveryLineCut, isDeliveryChargeLine, needsOffBooksFix, riderPayForJob } from './rider-direct-pay'
export { needsOffBooksFix }

export type PaidRiderInput = { amount: number; method: 'cash' | 'mpesa'; reference?: string }

/** What happened to the delivery charge on our books. */
export type OffBooksResult =
  | { kind: 'none'; note: string }
  | { kind: 'draft'; invoiceId: string; invoiceRef: string; removed: number }
  | { kind: 'credit_note'; invoiceId: string; invoiceRef: string; creditNoteRef: string; amount: number; customerCredit: number }
  | { kind: 'pending'; invoiceId?: string; invoiceRef?: string; pending: string }

const round2 = (n: number) => Math.round(n * 100) / 100
const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`
const POSTED = new Set(['approved', 'invoiced', 'dispatched', 'delivered', 'paid', 'partially_paid'])

/** The id the first version gave its "paid to rider" payment from the rider's link. */
export function paidToRiderPaymentId(jobId: string): string {
  const h = createHash('sha256').update(`paid-to-rider:${jobId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const creditReason = (jobRef: string) => `Delivery charge paid to the rider directly — ${jobRef}`

type InvoiceWithItems = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>
const loadInvoice = (id: string) => prisma.invoice.findUnique({ where: { id }, include: { items: true, client: true } })

/**
 * The invoice line that billed this trip's delivery charge: on the trip's
 * invoice, on the separate charge invoice raised when that one was already
 * posted ("Delivery charge — INV (DJ…)"), or on the repair's invoice.
 */
async function findDeliveryLine(job: Record<string, any>): Promise<{ invoice: InvoiceWithItems; item: InvoiceWithItems['items'][number] } | null> {
  const ids: string[] = []
  if (job.invoiceId) ids.push(String(job.invoiceId))
  const chargeInvoices = await prisma.invoice.findMany({
    where: { status: { not: 'cancelled' }, items: { some: { description: { contains: String(job.ref) } } } },
    select: { id: true },
  }).catch(() => [] as Array<{ id: string }>)
  ids.push(...chargeInvoices.map(i => i.id))
  if (job.repairOrderId) {
    const state = await loadAppState(['deed_repairs_v2'])
    const repair = (Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as Array<Record<string, any>> : []).find(r => r.id === job.repairOrderId)
    if (repair?.invoiceId) ids.push(String(repair.invoiceId))
  }
  for (const id of [...new Set(ids)]) {
    const invoice = await loadInvoice(id).catch(() => null)
    if (!invoice || ['cancelled', 'voided', 'rejected'].includes(String(invoice.status)) || Number(invoice.totalAmount) < 0) continue
    // On the separate charge invoice the line names the trip; elsewhere it is "Delivery charge".
    const item = invoice.items.find(i => isDeliveryChargeLine(i.description) && String(i.description).includes(String(job.ref)))
      ?? invoice.items.find(i => isDeliveryChargeLine(i.description))
    if (item && Number(item.lineTotal) > 0) return { invoice, item }
  }
  return null
}

/** A draft: shrink the delivery line, or remove it (and an invoice left with nothing on it). */
async function cutDraftLine(jobRef: string, invoice: InvoiceWithItems, item: InvoiceWithItems['items'][number], amount: number): Promise<OffBooksResult> {
  const cut = deliveryLineCut({ qty: Number(item.qty), lineSubtotal: Number(item.lineSubtotal) }, Number(item.qty), amount)
  if (!(cut.fraction > 0)) return { kind: 'none', note: 'nothing to take off the invoice' }
  const removed = await prisma.$transaction(async tx => {
    let newLineTotal = 0
    if (cut.fraction >= 0.9999) {
      await tx.invoiceItem.delete({ where: { id: item.id } })
    } else {
      const unitPrice = round2(Number(item.unitPrice) * (1 - cut.fraction))
      const m = computeInvoiceLineMoney({ qty: Number(item.qty), unitPrice, taxRate: Number(item.taxRate), discountPct: Number(item.discountPct) })
      await tx.invoiceItem.update({ where: { id: item.id }, data: { unitPrice, lineSubtotal: m.lineSubtotal, lineTax: m.lineTax, lineTotal: m.lineTotal, taxableBase: m.lineSubtotal } })
      newLineTotal = m.lineTotal
    }
    const items = await tx.invoiceItem.findMany({ where: { invoiceId: invoice.id } })
    const totals = computeInvoiceTotals(items.map(i => ({ qty: Number(i.qty), unitPrice: Number(i.unitPrice), taxRate: Number(i.taxRate), discountPct: Number(i.discountPct) })))
    const empty = !items.some(i => Number(i.lineTotal) > 0)
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        subtotal: totals.subtotal, taxAmount: totals.taxAmount, totalAmount: totals.totalAmount,
        lockVersion: { increment: 1 },
        ...(empty ? { status: 'cancelled' as const } : {}),
        notes: [invoice.notes, `Delivery charge paid to the rider directly (${jobRef}) — delivery line ${cut.fraction >= 0.9999 ? 'removed' : 'reduced'}`].filter(Boolean).join('\n').slice(0, 5000),
      },
    })
    return round2(Number(item.lineTotal) - newLineTotal)
  })
  return { kind: 'draft', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, removed }
}

/** A posted invoice: a credit note for the delivery line, up to what the rider got. */
async function creditPostedLine(job: Record<string, any>, invoice: InvoiceWithItems, item: InvoiceWithItems['items'][number], amount: number, actorId: string, actorName: string): Promise<OffBooksResult> {
  const reason = creditReason(String(job.ref))
  const already = await prisma.creditNote.findFirst({ where: { invoiceId: invoice.id, reason, status: { not: 'cancelled' } } })
  if (already) return { kind: 'credit_note', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, creditNoteRef: already.creditNoteNumber, amount: Number(already.amount), customerCredit: 0 }

  const prior = await prisma.creditNoteLine.aggregate({ where: { originalInvoiceItemId: item.id }, _sum: { qty: true } })
  const remainingQty = Number(item.qty) - Number(prior._sum.qty || 0)
  const cut = deliveryLineCut({ qty: Number(item.qty), lineSubtotal: Number(item.lineSubtotal) }, remainingQty, amount)
  if (!(cut.qty > 0)) return { kind: 'none', note: `the delivery charge on ${invoice.invoiceNumber} was already credited` }

  const lock = await checkFiscalLock(new Date())
  if (!lock.ok) return { kind: 'pending', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, pending: lock.error }

  const { getNextDocNumber } = await import('@/lib/doc-ref-counter')
  const { createCustomerCreditNote } = await import('@/lib/accounting/credit-note-service')
  const ref = await getNextDocNumber('credit_note')
  const result = await createCustomerCreditNote({ invoiceId: invoice.id, creditNoteNumber: ref, lines: [{ invoiceItemId: item.id, qty: cut.qty }], reason, actorId })

  // Already paid to us in full: the credit is the customer's, to refund or use.
  if (result.customerCredit > 0) {
    await withAppStateKeyLock('deed_customerCredits', async () => {
      const fresh = await loadAppStateForWrite(['deed_customerCredits'])
      const list = Array.isArray(fresh.deed_customerCredits) ? fresh.deed_customerCredits as any[] : []
      if (list.some(c => c?.ref === result.ref)) return
      list.unshift({
        id: randomUUID(), ref: result.ref,
        customerId: invoice.clientId, customerName: invoice.client?.name ?? job.customerName ?? '',
        sourceType: 'invoice', sourceInvoiceId: invoice.id, sourceInvoiceRef: invoice.invoiceNumber,
        amount: result.customerCredit, balance: result.customerCredit, status: 'available',
        createdAt: new Date().toISOString(), createdBy: actorName,
        notes: `${reason}. The customer had already paid it to us — refund it or keep it as credit.`,
        applications: [],
      })
      await saveStoreKeys({ deed_customerCredits: JSON.stringify(list) })
    })
  }
  return { kind: 'credit_note', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, creditNoteRef: result.ref, amount: result.amount, customerCredit: result.customerCredit }
}

/**
 * Take what the customer paid the rider off our books: off a draft's
 * delivery line, or by a credit note on a posted invoice. Never throws;
 * anything that stops it comes back as `pending` for the office to finish.
 */
export async function takeDeliveryChargeOffBooks(job: Record<string, any>, amount: number, actor?: { id: string; name: string }): Promise<OffBooksResult> {
  try {
    if (!(amount > 0)) return { kind: 'none', note: 'no amount' }
    const found = await findDeliveryLine(job)
    if (!found) return { kind: 'none', note: 'no delivery charge was billed on an invoice' }
    const { invoice, item } = found
    let status = String(invoice.status)
    if (status === 'pending_approval') return { kind: 'pending', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, pending: `${invoice.invoiceNumber} is waiting for approval` }
    if (status === 'draft') {
      // A draft that already reached the ledger (posting half-saved) is treated as posted.
      const booked = await prisma.journalEntry.count({ where: { invoiceId: invoice.id, isReversed: false } }).catch(() => 0)
      if (!booked) return await cutDraftLine(String(job.ref), invoice, item, amount)
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'approved' } })
      status = 'approved'
    }
    if (!POSTED.has(status)) return { kind: 'pending', invoiceId: invoice.id, invoiceRef: invoice.invoiceNumber, pending: `${invoice.invoiceNumber} is ${status}` }
    return await creditPostedLine(job, invoice, item, amount, actor?.id ?? invoice.createdById, actor?.name ?? 'System (rider link)')
  } catch (err) {
    console.error('[paid-to-rider] taking the charge off failed:', err)
    return { kind: 'pending', pending: 'the invoice could not be updated — use "Take it off the invoice now"' }
  } finally {
    await notifyStoreKeysChanged(['deed_invoices', 'deed_customerCredits']).catch(() => {})
  }
}

/** The fields kept on the trip about what happened on the books. */
function offBooksFields(r: OffBooksResult): Record<string, unknown> {
  const base = { pending: undefined, settled: undefined, creditNoteRef: undefined, removedFromDraft: undefined, customerCredit: undefined, offBooksNote: undefined }
  if (r.kind === 'none') return { ...base, offBooksNote: r.note }
  if (r.kind === 'pending') return { ...base, pending: r.pending, ...(r.invoiceId ? { invoiceId: r.invoiceId, invoiceRef: r.invoiceRef } : {}) }
  if (r.kind === 'draft') return { ...base, invoiceId: r.invoiceId, invoiceRef: r.invoiceRef, removedFromDraft: r.removed }
  return { ...base, invoiceId: r.invoiceId, invoiceRef: r.invoiceRef, creditNoteRef: r.creditNoteRef, customerCredit: r.customerCredit || undefined }
}

export function describeOffBooks(r: OffBooksResult): string {
  if (r.kind === 'none') return `Nothing on our books to change (${r.note})`
  if (r.kind === 'pending') return `Not yet taken off the invoice: ${r.pending}`
  if (r.kind === 'draft') return `${kes(r.removed)} taken off draft ${r.invoiceRef}`
  return `Credit note ${r.creditNoteRef} (${kes(r.amount)}) on ${r.invoiceRef}${r.customerCredit > 0 ? ` — ${kes(r.customerCredit)} was already paid to us: refund it or keep it as the customer's credit` : ''}`
}

async function saveOffBooks(jobId: string, r: OffBooksResult) {
  const patched = await updateDeliveryJob(jobId, j => ({ ok: true, job: { ...j, customerPaidRider: { ...(j as any).customerPaidRider, ...offBooksFields(r) } } as typeof j }))
  return patched.ok ? patched.job as Record<string, any> : null
}

async function notifyOffice(job: Record<string, any>, title: string, r: OffBooksResult, key: string) {
  try {
    const { publishNotificationEvent } = await import('@/lib/notifications/service')
    await publishNotificationEvent({
      entityType: 'delivery_job', actionUrl: '/delivery', entityId: job.id,
      eventType: 'delivery.rider_completed',
      title,
      body: [describeOffBooks(r), `rider pay for this trip now ${kes(riderPayForJob(job as any))}`].join(' · '),
      idempotencyKey: key,
    } as any)
  } catch (err) {
    console.error('[paid-to-rider] notification failed:', err)
  }
}

/**
 * Record that the customer paid the rider directly, then take it off our
 * books. Refused once recorded, or once the trip is in a rider pay run.
 */
export async function applyCustomerPaidRider(
  jobId: string,
  input: PaidRiderInput,
  opts: { by: string; capToCharge?: boolean; actor?: { id: string; name: string } },
): Promise<{ ok: true; job: Record<string, any>; offBooks: OffBooksResult } | { ok: false; error: string; status: number }> {
  const amount = round2(Number(input.amount) || 0)
  if (!(amount > 0)) return { ok: false, error: 'Enter the amount the customer paid', status: 400 }
  const pays = await loadAppState(['deed_riderWeeklyPays'])
  const inPay = (Array.isArray(pays.deed_riderWeeklyPays) ? pays.deed_riderWeeklyPays as Array<Record<string, any>> : [])
    .find(p => (p.jobIds ?? []).includes(jobId))
  if (inPay) return { ok: false, error: `This trip is already in rider pay ${inPay.ref ?? ''} — the office will take it off the next pay`.replace(/\s+—/, ' —'), status: 409 }

  const record = { amount, method: input.method === 'mpesa' ? 'mpesa' as const : 'cash' as const, reference: input.reference?.trim() || undefined, at: new Date().toISOString(), by: opts.by }
  const saved = await updateDeliveryJob(jobId, job => {
    const j = job as Record<string, any>
    if (j.customerPaidRider) return { ok: false, error: 'Already recorded' }
    if (!j.riderId) return { ok: false, error: 'No rider on this trip' }
    // From the rider's link it can be no more than the trip's delivery charge (or fee).
    const charge = Number(j.deliveryFee) > 0 ? Number(j.deliveryFee) : Number(j.riderFee) || 0
    if (opts.capToCharge && amount > charge + 0.005) return { ok: false, error: charge > 0 ? `The delivery charge for this trip is ${kes(charge)} — enter that or less` : 'This trip has no delivery charge — tell the office' }
    return { ok: true, job: { ...job, customerPaidRider: record } as typeof job }
  })
  if (!saved.ok) return saved

  const offBooks = await takeDeliveryChargeOffBooks(saved.job as Record<string, any>, amount, opts.actor)
  const job = await saveOffBooks(jobId, offBooks) ?? saved.job as Record<string, any>
  await notifyOffice(job, `${job.ref}: customer paid ${job.riderName ?? opts.by} ${kes(amount)} directly`, offBooks, `delivery:${jobId}:paid-to-rider`)
  return { ok: true, job, offBooks }
}

/** The office finishes one that could not be taken off the invoice before. */
export async function retryOffBooks(jobId: string, actor: { id: string; name: string }): Promise<{ ok: true; job: Record<string, any>; offBooks: OffBooksResult } | { ok: false; error: string; status: number }> {
  const state = await loadAppState(['deed_deliveryJobs'])
  const job = (Array.isArray(state.deed_deliveryJobs) ? state.deed_deliveryJobs as Array<Record<string, any>> : []).find(j => j.id === jobId)
  if (!job?.customerPaidRider) return { ok: false, error: 'Nothing recorded for this trip', status: 404 }
  if (!job.customerPaidRider.pending) return { ok: false, error: 'This one is already off the invoice', status: 409 }
  const offBooks = await takeDeliveryChargeOffBooks(job, Number(job.customerPaidRider.amount) || 0, actor)
  if (offBooks.kind === 'pending') return { ok: false, error: describeOffBooks(offBooks), status: 409 }
  const saved = await saveOffBooks(jobId, offBooks)
  return { ok: true, job: saved ?? job, offBooks }
}

/**
 * Undo the first version for one trip: reverse its "paid to rider" payment
 * (and the delivery-expense entry with it), then take the charge off the
 * invoice by credit note, as now.
 */
export async function fixOldPaidToRider(jobId: string, actor: { id: string; name: string }): Promise<{ ok: true; job: Record<string, any>; reversed: number; offBooks: OffBooksResult } | { ok: false; error: string; status: number }> {
  const state = await loadAppState(['deed_deliveryJobs'])
  const job = (Array.isArray(state.deed_deliveryJobs) ? state.deed_deliveryJobs as Array<Record<string, any>> : []).find(j => j.id === jobId)
  if (!job || !needsOffBooksFix(job)) return { ok: false, error: 'Nothing to fix on this trip', status: 409 }
  const invoiceId = String(job.customerPaidRider.invoiceId)

  // From the rider link: a fixed payment id. From the office: a payment whose reference names the trip.
  const payments = await prisma.payment.findMany({
    where: {
      isVoided: false,
      OR: [
        { id: paidToRiderPaymentId(jobId) },
        { invoiceId, reference: { contains: String(job.ref) } },
        { allocations: { some: { invoiceId } }, reference: { contains: String(job.ref) } },
      ],
    },
  })
  const riderPayments = payments.filter(p => p.id === paidToRiderPaymentId(jobId) || /paid to rider/i.test(String(p.reference ?? '')))
  const { reverseInvoicePayment } = await import('@/lib/accounting/payment-reversal.server')
  let reversed = 0
  for (const p of riderPayments) {
    await reverseInvoicePayment({ invoiceId, paymentId: p.id, reason: `Delivery charge paid to the rider directly (${job.ref}) — taken off the invoice by credit note instead`, actor })
    reversed = round2(reversed + Number(p.amount))
  }
  const offBooks = await takeDeliveryChargeOffBooks(job, Number(job.customerPaidRider.amount) || 0, actor)
  const patched = await updateDeliveryJob(jobId, j => ({
    ok: true,
    job: { ...j, customerPaidRider: { ...(j as any).customerPaidRider, ...offBooksFields(offBooks), fixedAt: new Date().toISOString(), reversedPayment: reversed || undefined } } as typeof j,
  }))
  return { ok: true, job: patched.ok ? patched.job as Record<string, any> : job, reversed, offBooks }
}
