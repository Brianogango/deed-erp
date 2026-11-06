import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys, withAppStateKeyLock, loadAppStateForWrite } from '@/lib/server-store'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { updateDeliveryJob } from './rider-portal.server'
import { PAID_TO_RIDER, RIDER_FEE_ACCOUNTS, riderFeeAccount, riderPayForJob } from './rider-direct-pay'

export type PaidRiderInput = { amount: number; method: 'cash' | 'mpesa'; reference?: string }

type SettleResult =
  | { settled: number; invoiceId: string; invoiceRef: string }
  | { settled: 0; invoiceId?: string; invoiceRef?: string; pending: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** A stable payment id per trip, so a retried tap never pays the invoice twice. */
export function paidToRiderPaymentId(jobId: string): string {
  const h = createHash('sha256').update(`paid-to-rider:${jobId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** The invoice the trip was charged on: its own, or the repair's. */
async function invoiceIdForJob(job: Record<string, any>): Promise<string | undefined> {
  if (job.invoiceId) return String(job.invoiceId)
  if (!job.repairOrderId) return undefined
  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as Array<Record<string, any>> : []
  const repair = repairs.find(r => r.id === job.repairOrderId)
  return repair?.invoiceId ? String(repair.invoiceId) : undefined
}

/**
 * Settle up to `maxSettle` of the trip's invoice with a "paid to rider"
 * payment: Dr rider-fee expense / Cr receivable. Never throws: anything that
 * stops it comes back as `pending` so the office can finish it by hand.
 */
export async function settlePaidToRider(job: Record<string, any>, maxSettle: number): Promise<SettleResult> {
  try {
    const invoiceId = await invoiceIdForJob(job)
    if (!invoiceId) return { settled: 0, pending: 'no invoice is linked to this trip' }
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) return { settled: 0, invoiceId, pending: 'the linked invoice was not found' }
    const invoiceRef = invoice.invoiceNumber

    // The screen copy can say posted while the table still says draft (as in the payments route).
    const state = await loadAppState(['deed_invoices'])
    const mirror = (Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, any>> : []).find(i => i.id === invoiceId)
    const posted = (s: string) => s !== 'pending_approval' && s !== 'rejected' && invoiceDocState(s) === 'posted'
    if (mirror?.type === 'vendor_bill') return { settled: 0, invoiceId, invoiceRef, pending: `${invoiceRef} is not a customer invoice` }
    if (!posted(String(invoice.status))) {
      if (invoice.status === 'draft' && posted(String(mirror?.status ?? ''))) {
        await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'approved' } })
      } else {
        return { settled: 0, invoiceId, invoiceRef, pending: `${invoiceRef} is not posted yet` }
      }
    }
    if (invoice.paymentBlocked) return { settled: 0, invoiceId, invoiceRef, pending: `payments are blocked on ${invoiceRef}` }

    const paidAt = new Date()
    const lock = await checkFiscalLock(paidAt)
    if (!lock.ok) return { settled: 0, invoiceId, invoiceRef, pending: lock.error }

    const balance = round2(Number(invoice.totalAmount) - Number(invoice.amountPaid))
    const amount = round2(Math.min(maxSettle, balance))
    if (!(amount > 0)) return { settled: 0, invoiceId, invoiceRef, pending: `${invoiceRef} has nothing left to settle` }

    const codes = await prisma.accountCode.findMany({ where: { code: { in: RIDER_FEE_ACCOUNTS.map(a => a.code) }, isActive: true }, select: { code: true } })
    const feeAccount = riderFeeAccount(codes.map(c => c.code))
    const paymentId = paidToRiderPaymentId(String(job.id))
    const reference = `Paid to rider ${job.riderName ?? ''} (${job.ref})`.replace(/\s+/g, ' ').slice(0, 120)
    const createdById = invoice.createdById

    const { recordPaymentWithAllocations } = await import('@/lib/accounting/payment-allocations')
    const result = await recordPaymentWithAllocations({
      amount,
      paymentMethod: PAID_TO_RIDER,
      reference,
      externalReference: reference,
      paidAt,
      notes: `idempotency:${paymentId} · delivery job ${job.id}`,
      createdById,
      invoiceId,
      paymentType: 'customer_receipt',
      partnerId: invoice.clientId,
      currencyCode: invoice.currencyCode,
      exchangeRateToBase: Number(invoice.exchangeRateToBase || 1),
      idempotencyKey: paymentId,
      allocations: [{ invoiceId, amount }],
      journal: pid => ({
        ref: `JRN/PAY/${invoice.invoiceNumber}/${pid}`.slice(0, 80),
        journalCode: 'MISC',
        date: paidAt,
        description: `Delivery charge paid to rider for ${invoice.invoiceNumber} (${job.ref})`,
        sourceType: 'payment',
        sourceId: pid,
        invoiceId,
        paymentId: pid,
        createdById,
        skipIfExists: true,
        lines: [
          { accountLabel: feeAccount.label, label: `Paid to rider ${job.ref}`, debit: amount, credit: 0, partnerId: invoice.clientId },
          { accountLabel: labelForRole('ar'), label: `AR settlement ${invoice.invoiceNumber}`, debit: 0, credit: amount, partnerId: invoice.clientId },
        ],
      }),
    })

    // Raise the screen copy too (as the payments route does).
    const updated = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (updated) {
      await withAppStateKeyLock('deed_invoices', async () => {
        const s = await loadAppStateForWrite(['deed_invoices'])
        const rows = Array.isArray(s.deed_invoices) ? s.deed_invoices as Array<Record<string, any>> : []
        const row = rows.find(i => i.id === invoiceId)
        const paid = Number(updated.amountPaid)
        if (!row || (Number(row.amountPaid) || 0) >= paid) return
        row.amountPaid = paid
        await saveStoreKeys({ deed_invoices: JSON.stringify(rows) })
      }).catch(err => console.error('[paid-to-rider] invoice copy update failed:', err))
    }
    await import('@/lib/server-store').then(m => m.notifyStoreKeysChanged(['deed_invoices'])).catch(() => {})
    void result
    return { settled: amount, invoiceId, invoiceRef }
  } catch (err) {
    console.error('[paid-to-rider] settle failed:', err)
    return { settled: 0, pending: 'the invoice could not be updated — record it from the invoice' }
  }
}

/**
 * Record that the customer paid the rider directly, then settle the invoice.
 * Refused once recorded, or once the trip is in a rider pay run.
 */
export async function applyCustomerPaidRider(
  jobId: string,
  input: PaidRiderInput,
  opts: { by: string; maxSettle: number; capToCharge?: boolean },
): Promise<{ ok: true; job: Record<string, any>; settle: SettleResult } | { ok: false; error: string; status: number }> {
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
    if (opts.capToCharge && amount > charge + 0.005) return { ok: false, error: charge > 0 ? `The delivery charge for this trip is KES ${charge.toLocaleString('en-KE')} — enter that or less` : 'This trip has no delivery charge — tell the office' }
    return { ok: true, job: { ...job, customerPaidRider: record } as typeof job }
  })
  if (!saved.ok) return saved

  const settle = await settlePaidToRider(saved.job as Record<string, any>, Math.min(amount, opts.maxSettle))
  let job = saved.job as Record<string, any>
  const extra = {
    ...(settle.invoiceId ? { invoiceId: settle.invoiceId, invoiceRef: settle.invoiceRef } : {}),
    settled: settle.settled,
    ...('pending' in settle ? { pending: settle.pending } : {}),
  }
  const patched = await updateDeliveryJob(jobId, j => ({ ok: true, job: { ...j, customerPaidRider: { ...(j as any).customerPaidRider, ...extra } } as typeof j }))
  if (patched.ok) job = patched.job as Record<string, any>

  const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`
  try {
    const { publishNotificationEvent } = await import('@/lib/notifications/service')
    await publishNotificationEvent({
      entityType: 'delivery_job', actionUrl: '/delivery', entityId: jobId,
      eventType: 'delivery.rider_completed',
      title: `${job.ref}: customer paid ${job.riderName ?? opts.by} ${kes(amount)} directly`,
      body: [
        settle.settled > 0 ? `${kes(settle.settled)} settled on ${settle.invoiceRef}` : `Not settled on an invoice: ${'pending' in settle ? settle.pending : ''}`,
        `rider pay for this trip now ${kes(riderPayForJob(job as any))}`,
      ].join(' · '),
      idempotencyKey: `delivery:${jobId}:paid-to-rider`,
    } as any)
  } catch (err) {
    console.error('[paid-to-rider] notification failed:', err)
  }
  return { ok: true, job, settle }
}
