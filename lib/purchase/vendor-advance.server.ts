import 'server-only'

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { BankAccountRefError, cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { isPayableInvoiceStatus, paymentMethodEnum } from '@/lib/accounting/payment-allocations'
import { ensureTemplateAccounts } from '@/lib/accounting/ensure-template-accounts'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import {
  ADVANCE_APPLIED_TYPE, ADVANCE_REFUND_TYPE, ADVANCE_TYPE,
  advanceIdFromRefundNote, advanceNote, advanceOpen, planAdvanceApplication, poIdFromAdvanceNote, refundNote,
  type AdvanceSummary,
} from './vendor-advance-core'

/** See lib/purchase/vendor-advance-core.ts for the postings. */

type Db = typeof prisma | Prisma.TransactionClient
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const ADVANCES_ACCOUNT = '1934'
const OPEN_ORDER = new Set(['sent', 'confirmed', 'partial', 'received'])

export function fail(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status })
}

/** Advances (with what is still open), for some orders or all of them. */
export async function loadAdvances(db: Db, poIds?: string[]): Promise<AdvanceSummary[]> {
  const rows = await db.payment.findMany({
    where: { paymentType: ADVANCE_TYPE, isVoided: false, notes: { startsWith: 'po:' } },
    include: { allocations: { where: { reversedAt: null }, select: { amount: true } } },
    orderBy: { paidAt: 'asc' },
  })
  const wanted = poIds ? new Set(poIds) : null
  const mine = rows.filter(r => { const po = poIdFromAdvanceNote(r.notes); return po && (!wanted || wanted.has(po)) })
  if (!mine.length) return []
  const refunds = await db.payment.findMany({
    where: { paymentType: ADVANCE_REFUND_TYPE, isVoided: false, notes: { startsWith: 'advance:' } },
    select: { amount: true, notes: true },
  })
  const refundedBy = new Map<string, number>()
  for (const r of refunds) {
    const id = advanceIdFromRefundNote(r.notes)
    if (id) refundedBy.set(id, money((refundedBy.get(id) ?? 0) + Number(r.amount)))
  }
  return mine.map(r => {
    const applied = money(r.allocations.reduce((s, a) => s + Number(a.amount), 0))
    const refunded = refundedBy.get(r.id) ?? 0
    return {
      id: r.id,
      poId: poIdFromAdvanceNote(r.notes)!,
      amount: money(r.amount),
      applied,
      refunded,
      open: advanceOpen(Number(r.amount), applied, refunded),
      paidAt: r.paidAt.toISOString(),
      method: String(r.paymentMethod),
      reference: r.reference,
    }
  })
}

/**
 * Whether money was paid in advance on this order (so it may be billed before
 * delivery). Any failure reads as "no": the usual received-quantity rule holds.
 */
export async function orderIsPrepaid(db: Db, poId: string): Promise<boolean> {
  try {
    if (typeof (db as { payment?: { findMany?: unknown } }).payment?.findMany !== 'function') return false
    return (await loadAdvances(db, [poId])).length > 0
  } catch {
    return false
  }
}

async function cashLabel(method: string, bankAccountId?: string | null): Promise<string> {
  if (bankAccountId) {
    try { return await cashLabelForBankAccount(prisma, String(bankAccountId)) } catch (err) {
      if (err instanceof BankAccountRefError) fail(err.message, err.status)
      throw err
    }
  }
  return method === 'bank_transfer' || method === 'cheque' ? labelForRole('bank_absa') : labelForRole('cash_mobile')
}

async function refreshScreens() {
  try {
    const { refreshInvoicesBlob } = await import('@/lib/documents-broadcast.server')
    await refreshInvoicesBlob()
  } catch (err) {
    console.error('[vendor-advance] invoices refresh failed:', err)
  }
  await notifyStoreKeysChanged(['deed_purchaseOrders', 'deed_journalEntries']).catch(() => {})
}

const validDate = (v: unknown) => {
  const d = v ? new Date(String(v)) : new Date()
  if (Number.isNaN(d.getTime())) fail('Invalid date', 422)
  return d
}

/** Pay a supplier before the goods arrive: Dr Advances to Suppliers / Cr bank. */
export async function recordAdvance(input: {
  poId: string; amount: unknown; method: unknown; bankAccountId?: unknown; reference?: unknown; date?: unknown; actorId: string
}) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: input.poId } })
  if (!po) fail('Purchase order not found', 404)
  if (!OPEN_ORDER.has(String(po.status))) fail(po.status === 'draft' ? 'Confirm the order with the supplier before paying in advance' : 'This order is cancelled')
  if (!po.clientId) fail('The order has no supplier')
  const amount = money(input.amount)
  if (amount <= 0) fail('Enter the amount paid', 422)
  const already = (await loadAdvances(prisma, [po.id])).reduce((s, a) => s + a.amount - a.refunded, 0)
  const room = money(Number(po.totalAmount) - already)
  if (amount > room + 0.009) fail(`That is more than the order: ${po.poNumber} is KES ${Number(po.totalAmount).toLocaleString('en-KE')} and KES ${money(already).toLocaleString('en-KE')} is already paid in advance`, 422)
  const method = paymentMethodEnum(input.method || 'bank_transfer')
  if (method === 'credit') fail('Pick how it was paid', 422)
  const when = validDate(input.date)
  const lock = await checkFiscalLock(when)
  if (!lock.ok) fail(lock.error ?? 'That period is locked', lock.status ?? 409)
  const bankAccountId = input.bankAccountId ? String(input.bankAccountId) : null
  const fromLabel = await cashLabel(method, bankAccountId)
  const reference = String(input.reference ?? '').trim().slice(0, 80) || null
  await ensureTemplateAccounts([ADVANCES_ACCOUNT])

  const payment = await prisma.$transaction(async tx => {
    const p = await tx.payment.create({
      data: {
        invoiceId: null,
        amount, amountBase: amount,
        paymentType: ADVANCE_TYPE,
        partnerId: po.clientId,
        currencyCode: 'KES',
        paymentMethod: method as never,
        bankAccountId: bankAccountId && /^[0-9a-f-]{36}$/i.test(bankAccountId) ? bankAccountId : null,
        reference,
        externalReference: po.poNumber,
        paidAt: when,
        notes: advanceNote(po.id, po.poNumber),
        createdById: input.actorId,
      },
    })
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/VADV/${po.poNumber}/${p.id.slice(0, 8)}`.slice(0, 80),
      journalCode: method === 'cash' || method === 'mpesa' ? 'CSH' : 'BNK',
      date: when,
      description: `Advance to supplier on ${po.poNumber}`,
      sourceType: 'payment',
      sourceId: p.id,
      paymentId: p.id,
      createdById: input.actorId,
      lines: [
        { accountLabel: labelForRole('supplier_advances'), label: `Advance on ${po.poNumber}`, debit: amount, credit: 0, partnerId: po.clientId },
        { accountLabel: fromLabel, label: `Advance to supplier ${po.poNumber}${reference ? ` (${reference})` : ''}`, debit: 0, credit: amount, partnerId: po.clientId },
      ],
    })
    await tx.payment.update({ where: { id: p.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
    await writeFinancialAuditInTx(tx, {
      userId: input.actorId, action: 'vendor_advance_paid', entityType: 'purchase_order', entityId: po.id, relatedJournalId: journal.id,
      newValues: { poRef: po.poNumber, amount, method, reference, paymentId: p.id },
    })
    return p
  })
  await refreshScreens()
  return { id: payment.id, poRef: po.poNumber, amount }
}

/**
 * Use an order's open advances on its bill: Dr Payables / Cr Advances to
 * Suppliers, recorded as a payment on the bill. Nothing when there is none.
 */
export async function applyAdvancesToBill(billId: string, actorId: string) {
  const bill = await prisma.invoice.findUnique({ where: { id: billId } })
  if (!bill) fail('Bill not found', 404)
  if (bill.documentType !== 'vendor_bill' || Number(bill.totalAmount) <= 0) fail('Pick a supplier bill', 400)
  if (!bill.purchaseOrderId) return { applied: 0, billRef: bill.invoiceNumber }
  if (!isPayableInvoiceStatus(String(bill.status))) fail('Confirm the bill first')
  if (bill.paymentBlocked) fail('Payments are blocked on this bill')
  const owed = money(Number(bill.totalAmount) - Number(bill.amountPaid))
  if (owed <= 0) return { applied: 0, billRef: bill.invoiceNumber }
  const advances = (await loadAdvances(prisma, [bill.purchaseOrderId])).filter(a => a.open > 0)
  const plan = planAdvanceApplication(owed, advances)
  if (!plan.length) return { applied: 0, billRef: bill.invoiceNumber }
  const when = new Date()
  const lock = await checkFiscalLock(when)
  if (!lock.ok) fail(lock.error ?? 'That period is locked', lock.status ?? 409)
  const po = await prisma.purchaseOrder.findUnique({ where: { id: bill.purchaseOrderId }, select: { poNumber: true } })
  const poRef = po?.poNumber ?? 'the order'

  const total = await prisma.$transaction(async tx => {
    let sum = 0
    for (const step of plan) {
      const p = await tx.payment.create({
        data: {
          invoiceId: bill.id,
          amount: step.amount, amountBase: step.amount,
          paymentType: ADVANCE_APPLIED_TYPE,
          partnerId: bill.clientId,
          currencyCode: bill.currencyCode,
          paymentMethod: 'credit' as never,
          reference: `Advance ${poRef}`.slice(0, 80),
          externalReference: poRef,
          reconciliationStatus: 'not_applicable',
          paidAt: when,
          notes: `method:vendor_advance · Advance paid on ${poRef} used on ${bill.invoiceNumber}`,
          createdById: actorId,
        },
      })
      const journal = await createJournalEntryInTx(tx, {
        ref: `JRN/VADA/${bill.invoiceNumber}/${p.id.slice(0, 8)}`.slice(0, 80),
        journalCode: 'MISC',
        date: when,
        description: `Advance on ${poRef} applied to ${bill.invoiceNumber}`,
        sourceType: 'payment',
        sourceId: p.id,
        invoiceId: bill.id,
        paymentId: p.id,
        createdById: actorId,
        lines: [
          { accountLabel: labelForRole('ap'), label: `${bill.invoiceNumber} settled by advance`, debit: step.amount, credit: 0, partnerId: bill.clientId },
          { accountLabel: labelForRole('supplier_advances'), label: `Advance on ${poRef} used`, debit: 0, credit: step.amount, partnerId: bill.clientId },
        ],
      })
      await tx.payment.update({ where: { id: p.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
      await tx.paymentAllocation.create({ data: { paymentId: step.id, invoiceId: bill.id, amount: step.amount, applicationDate: when } })
      sum = money(sum + step.amount)
    }
    await tx.invoice.update({ where: { id: bill.id }, data: { amountPaid: money(Number(bill.amountPaid) + sum) } })
    await writeFinancialAuditInTx(tx, {
      userId: actorId, action: 'vendor_advance_applied', entityType: 'invoice', entityId: bill.id,
      newValues: { billRef: bill.invoiceNumber, poRef, amount: sum, advances: plan },
    })
    return sum
  })
  await refreshScreens()
  return { applied: total, billRef: bill.invoiceNumber }
}

/** The supplier paid an advance back (never delivered): Dr bank / Cr Advances. */
export async function refundAdvance(input: {
  advanceId: string; amount?: unknown; method: unknown; bankAccountId?: unknown; reference?: unknown; date?: unknown; actorId: string
}) {
  const advance = await prisma.payment.findUnique({ where: { id: input.advanceId } })
  if (!advance || advance.paymentType !== ADVANCE_TYPE || advance.isVoided) fail('Advance not found', 404)
  const poId = poIdFromAdvanceNote(advance.notes)
  const summary = (await loadAdvances(prisma, poId ? [poId] : undefined)).find(a => a.id === advance.id)
  const open = summary?.open ?? 0
  if (open <= 0) fail('Nothing of this advance is left to refund')
  const amount = money(Math.min(Number(input.amount) || open, open))
  if (amount <= 0) fail('Enter the amount the supplier paid back', 422)
  const method = paymentMethodEnum(input.method || 'bank_transfer')
  if (method === 'credit') fail('A refund is money received — pick how it was paid', 422)
  const when = validDate(input.date)
  const lock = await checkFiscalLock(when)
  if (!lock.ok) fail(lock.error ?? 'That period is locked', lock.status ?? 409)
  const bankAccountId = input.bankAccountId ? String(input.bankAccountId) : null
  const toLabel = await cashLabel(method, bankAccountId)
  const reference = String(input.reference ?? '').trim().slice(0, 80) || null
  const poRef = advance.externalReference ?? 'the order'

  await prisma.$transaction(async tx => {
    const p = await tx.payment.create({
      data: {
        invoiceId: null,
        amount, amountBase: amount,
        paymentType: ADVANCE_REFUND_TYPE,
        partnerId: advance.partnerId,
        currencyCode: advance.currencyCode,
        paymentMethod: method as never,
        bankAccountId: bankAccountId && /^[0-9a-f-]{36}$/i.test(bankAccountId) ? bankAccountId : null,
        reference,
        externalReference: poRef,
        paidAt: when,
        notes: refundNote(advance.id, poRef),
        createdById: input.actorId,
      },
    })
    const journal = await createJournalEntryInTx(tx, {
      ref: `JRN/VADR/${poRef}/${p.id.slice(0, 8)}`.slice(0, 80),
      journalCode: method === 'cash' || method === 'mpesa' ? 'CSH' : 'BNK',
      date: when,
      description: `Supplier refunded advance on ${poRef}`,
      sourceType: 'payment',
      sourceId: p.id,
      paymentId: p.id,
      createdById: input.actorId,
      lines: [
        { accountLabel: toLabel, label: `Advance refund ${poRef}${reference ? ` (${reference})` : ''}`, debit: amount, credit: 0, partnerId: advance.partnerId },
        { accountLabel: labelForRole('supplier_advances'), label: `Advance on ${poRef} refunded`, debit: 0, credit: amount, partnerId: advance.partnerId },
      ],
    })
    await tx.payment.update({ where: { id: p.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
    await writeFinancialAuditInTx(tx, {
      userId: input.actorId, action: 'vendor_advance_refunded', entityType: 'payment', entityId: advance.id, relatedJournalId: journal.id,
      newValues: { poRef, amount, method, reference, paymentId: p.id },
    })
  })
  await refreshScreens()
  return { refunded: amount, poRef }
}

/** Orders with money paid in advance: open amount per order (for the order list). */
export async function advanceTotalsByPo(db: Db = prisma): Promise<Map<string, { paid: number; open: number }>> {
  const out = new Map<string, { paid: number; open: number }>()
  for (const a of await loadAdvances(db)) {
    const cur = out.get(a.poId) ?? { paid: 0, open: 0 }
    out.set(a.poId, { paid: money(cur.paid + a.amount - a.refunded), open: money(cur.open + a.open) })
  }
  return out
}
