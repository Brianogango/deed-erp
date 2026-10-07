import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { ensureInvoiceBooked } from '@/lib/accounting/ensure-invoice-booked.server'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { OPENING_BALANCE_MARKER } from '@/lib/finance/opening-balance'
import { planExtraPaymentEntries, type ExtraPaymentPlan, type PaymentEntry } from '@/lib/accounting/document-ledger-repair'

export type UnbookedDoc = { invoiceId: string; ref: string; kind: 'invoice' | 'bill'; date: string; total: number; paid: number }
export type ReviewDoc = { ref: string; kind: 'invoice' | 'bill'; total: number; paid: number; ledgerPaid: number; reason: string }

const money = (n: number) => Math.round(n * 100) / 100
const POSTED = ['approved', 'invoiced', 'paid', 'partially_paid'] as const

export async function findDocumentLedgerRepairs(): Promise<{ extraPayments: ExtraPaymentPlan[]; unbooked: UnbookedDoc[]; review: ReviewDoc[] }> {
  const docs = await prisma.invoice.findMany({
    where: { status: { in: [...POSTED] }, NOT: { totalAmount: 0 }, isPosInvoice: false },
    select: { id: true, invoiceNumber: true, documentType: true, invoiceDate: true, totalAmount: true, amountPaid: true, internalNotes: true },
  })
  const docIds = docs.map(d => d.id)
  const entries = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: docIds }, isPosted: true },
    select: {
      id: true, ref: true, invoiceId: true, paymentId: true, sourceType: true, isReversed: true, reversalOfId: true, createdAt: true,
      lines: { where: { OR: [{ accountLabel: { startsWith: '1800' } }, { accountLabel: { startsWith: '3000' } }] }, select: { accountLabel: true, debit: true, credit: true } },
    },
  })
  const allocations = await prisma.paymentAllocation.findMany({
    where: { invoiceId: { in: docIds }, reversedAt: null, payment: { isVoided: false } },
    select: { invoiceId: true, paymentId: true, amount: true },
  })
  const direct = await prisma.payment.findMany({
    where: { invoiceId: { in: docIds }, isVoided: false, allocations: { none: {} } },
    select: { id: true, invoiceId: true, amount: true },
  })

  const byDoc = new Map<string, typeof entries>()
  for (const e of entries) byDoc.set(e.invoiceId!, [...(byDoc.get(e.invoiceId!) ?? []), e])
  const paymentsByDoc = new Map<string, Map<string, number>>()
  const addPay = (doc: string, id: string, amt: number) => {
    const m = paymentsByDoc.get(doc) ?? new Map<string, number>()
    m.set(id, money((m.get(id) ?? 0) + amt))
    paymentsByDoc.set(doc, m)
  }
  for (const a of allocations) addPay(a.invoiceId, a.paymentId, Number(a.amount))
  for (const p of direct) addPay(p.invoiceId!, p.id, Number(p.amount))

  const extraPayments: ExtraPaymentPlan[] = []
  const unbooked: UnbookedDoc[] = []
  const review: ReviewDoc[] = []
  for (const d of docs) {
    const isBill = d.documentType === 'vendor_bill'
    const kind = isBill ? 'bill' as const : 'invoice' as const
    const own = (l: { accountLabel: string; debit: unknown; credit: unknown }) => isBill
      ? (l.accountLabel.startsWith('3000') ? Number(l.credit) - Number(l.debit) : 0)
      : (l.accountLabel.startsWith('1800') ? Number(l.debit) - Number(l.credit) : 0)
    const list = byDoc.get(d.id) ?? []
    const isPay = (ref: string) => ref.replace(/^(REV\/)+/, '').startsWith('JRN/PAY')
    const booked = money(list.filter(e => !isPay(e.ref)).reduce((s, e) => s + e.lines.reduce((t, l) => t + own(l), 0), 0))
    const livePay: PaymentEntry[] = list
      .filter(e => isPay(e.ref) && !e.isReversed && !e.reversalOfId)
      .map(e => ({ id: e.id, ref: e.ref, paymentId: e.paymentId, amount: money(-e.lines.reduce((t, l) => t + own(l), 0)), createdAt: e.createdAt.toISOString() }))
    const payments = [...(paymentsByDoc.get(d.id) ?? new Map()).entries()].map(([id, amount]) => ({ id, amount }))
    const recorded = money(payments.reduce((s, p) => s + p.amount, 0))
    const ledgerPaid = money(livePay.reduce((s, e) => s + e.amount, 0))
    const total = Number(d.totalAmount)
    const base = { ref: d.invoiceNumber, kind, total, paid: Number(d.amountPaid) }

    const livePosting = list.some(e => !e.isReversed && !e.reversalOfId && ['invoice', 'bill'].includes(String(e.sourceType)) && isPostingRef(e.ref, d.invoiceNumber))
    if (!livePosting && Math.abs(booked) < 1 && !String(d.internalNotes ?? '').includes(OPENING_BALANCE_MARKER) && !d.invoiceNumber.startsWith('POS')) {
      unbooked.push({ invoiceId: d.id, ...base, date: d.invoiceDate ? d.invoiceDate.toISOString().slice(0, 10) : '' })
    }

    const plan = planExtraPaymentEntries({ invoiceId: d.id, ref: d.invoiceNumber, payments, entries: livePay })
    if (plan) extraPayments.push(plan)
    const after = money(ledgerPaid - (plan?.reverse.reduce((s, r) => s + r.amount, 0) ?? 0))
    if (recorded < 0.5 && ledgerPaid > 0.5) review.push({ ...base, ledgerPaid, reason: 'Ledger has payment entries but no payment is recorded on the document' })
    else if (after > recorded + 0.5) review.push({ ...base, ledgerPaid: after, reason: 'Ledger payments exceed recorded payments by an amount that is not a copy' })
    else if (recorded > ledgerPaid + 0.5) review.push({ ...base, ledgerPaid, reason: 'Payment recorded on the document but not in the ledger' })
  }
  const byRef = (a: { ref: string }, b: { ref: string }) => a.ref.localeCompare(b.ref)
  return { extraPayments: extraPayments.sort(byRef), unbooked: unbooked.sort(byRef), review: review.sort(byRef) }
}

type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

export async function applyDocumentLedgerRepairs(actorId: string): Promise<Result[]> {
  const { extraPayments, unbooked } = await findDocumentLedgerRepairs()
  const results: Result[] = []
  for (const plan of extraPayments) {
    for (const r of plan.reverse) {
      try {
        const original = await prisma.journalEntry.findUniqueOrThrow({ where: { ref: r.ref }, select: { id: true } })
        const rev = await reverseJournalEntry(r.ref, actorId)
        await writeFinancialAudit({
          userId: actorId,
          action: 'reverse_duplicate_payment_journal',
          entityType: 'invoice',
          entityId: plan.invoiceId,
          relatedJournalId: rev.id,
          oldValues: { journalRef: r.ref, journalId: original.id, amount: r.amount, ledgerPaid: plan.booked, recorded: plan.recorded },
          newValues: { reversedBy: rev.ref },
        })
        results.push({ ref: plan.ref, status: 'fixed', message: `Reversed copy ${r.ref} (KES ${Math.round(r.amount).toLocaleString('en-KE')})` })
      } catch (err) {
        results.push({ ref: plan.ref, status: 'failed', message: `${r.ref}: ${err instanceof Error ? err.message : 'could not reverse'}` })
      }
    }
  }
  for (const doc of unbooked) {
    try {
      const out = await ensureInvoiceBooked(doc.invoiceId, actorId)
      await writeFinancialAudit({
        userId: actorId,
        action: 'rebook_unbooked_document',
        entityType: 'invoice',
        entityId: doc.invoiceId,
        oldValues: { liveEntry: null, total: doc.total },
        newValues: { journalRef: out.ref, action: out.action },
      })
      results.push({ ref: doc.ref, status: 'fixed', message: `Booked as ${out.ref}` })
    } catch (err) {
      results.push({ ref: doc.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not book' })
    }
  }
  return results
}
