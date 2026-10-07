import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { ensureInvoiceBooked } from '@/lib/accounting/ensure-invoice-booked.server'
import { postInvoicePaymentJournalToPrisma } from '@/lib/accounting/invoice-journals'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { OPENING_BALANCE_MARKER } from '@/lib/finance/opening-balance'
import { planExtraPaymentEntries, planUnlinkedReversals, type ExtraPaymentPlan, type PaymentEntry, type UnlinkedReversal } from '@/lib/accounting/document-ledger-repair'

type UnbookedDoc = { invoiceId: string; ref: string; kind: 'invoice' | 'bill'; date: string; total: number; paid: number }
/**
 * record_payment: the ledger entry is the money; add the payment record it lacks.
 * book_payment:   the payment record is the money; post the entry it lacks.
 * Neither is applied without a director approving that row.
 */
type ReviewAction = 'record_payment' | 'book_payment'
type ReviewDoc = { invoiceId: string; ref: string; kind: 'invoice' | 'bill'; total: number; paid: number; ledgerPaid: number; reason: string; action?: ReviewAction }

const money = (n: number) => Math.round(n * 100) / 100
const POSTED = ['approved', 'invoiced', 'paid', 'partially_paid'] as const

type BillAsSale = { invoiceId: string; ref: string; journalRef: string; amount: number }
type StalePosting = { invoiceId: string; ref: string; journalRef: string; booked: number; total: number }
type Misattached = { journalId: string; journalRef: string; fromRef: string; toInvoiceId: string; toRef: string; amount: number }
type TillAsInvoice = { invoiceId: string; ref: string; date: string; total: number; method: string }

const SKIP_REF = /^JRN\/(PAY|PAY-AP|DEL|CAPP|DEP|REFUND)\//

/** One live posting entry at an amount that is no longer the document's (edited after booking: INV/2026/0273). */
async function findStalePostings(): Promise<StalePosting[]> {
  const docs = await prisma.invoice.findMany({
    where: { status: { in: [...POSTED] }, NOT: { totalAmount: 0 }, isPosInvoice: false },
    select: { id: true, invoiceNumber: true, totalAmount: true, internalNotes: true },
  })
  const entries = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: docs.map(d => d.id) }, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
    select: { ref: true, invoiceId: true, totalDebit: true },
  })
  const out: StalePosting[] = []
  for (const d of docs) {
    if (d.invoiceNumber.startsWith('POS') || String(d.internalNotes ?? '').includes(OPENING_BALANCE_MARKER)) continue
    const live = entries.filter(e => e.invoiceId === d.id && isPostingRef(e.ref, d.invoiceNumber))
    if (live.length !== 1) continue
    const booked = Number(live[0].totalDebit)
    const total = Math.abs(Number(d.totalAmount))
    if (Math.abs(booked - total) > 0.01) out.push({ invoiceId: d.id, ref: d.invoiceNumber, journalRef: live[0].ref, booked, total })
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref))
}

/** A document's posting entry attached to another document (JRN/BILL/2026/0037 on BILL/2026/0166). */
async function findMisattachedPostings(): Promise<Misattached[]> {
  const entries = await prisma.journalEntry.findMany({
    where: { sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null, invoiceId: { not: null }, ref: { startsWith: 'JRN/' } },
    select: { id: true, ref: true, invoiceId: true, totalDebit: true },
  })
  const candidates = entries.filter(e => !SKIP_REF.test(e.ref))
  const docs = await prisma.invoice.findMany({
    where: { id: { in: [...new Set(candidates.map(e => e.invoiceId!))] } },
    select: { id: true, invoiceNumber: true },
  })
  const numberOf = new Map(docs.map(d => [d.id, d.invoiceNumber]))
  // The ref names a document number, possibly with a copy suffix (/2). The
  // number itself can end in digits (INV/2026/0102), so both readings are tried.
  const misplaced = candidates
    .map(e => ({ e, own: numberOf.get(e.invoiceId!) ?? '' }))
    .filter(x => x.own && !isPostingRef(x.e.ref, x.own))
  if (!misplaced.length) return []
  const readings = (ref: string) => { const full = ref.slice(4); return [full, full.replace(/\/\d+$/, '')] }
  const targets = await prisma.invoice.findMany({
    where: { invoiceNumber: { in: [...new Set(misplaced.flatMap(x => readings(x.e.ref)))] } },
    select: { id: true, invoiceNumber: true, totalAmount: true },
  })
  const byNumber = new Map(targets.map(t => [t.invoiceNumber, t]))
  const wrong = misplaced
    .map(x => ({ ...x, named: readings(x.e.ref).find(n => byNumber.has(n) && isPostingRef(x.e.ref, n)) ?? '' }))
    .filter(x => x.named && x.named !== x.own)
  const out: Misattached[] = []
  for (const w of wrong) {
    const target = byNumber.get(w.named)
    // Only when the named document exists and the entry is exactly its amount.
    if (!target || Math.abs(Math.abs(Number(target.totalAmount)) - Number(w.e.totalDebit)) > 0.01) continue
    const toInvoiceId = target.id
    // Only when the named document has no live posting entry of its own.
    const own = await prisma.journalEntry.findFirst({
      where: { invoiceId: toInvoiceId, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null, ref: { startsWith: `JRN/${w.named}` } },
      select: { ref: true },
    })
    if (own && isPostingRef(own.ref, w.named)) continue
    out.push({ journalId: w.e.id, journalRef: w.e.ref, fromRef: w.own, toInvoiceId, toRef: w.named, amount: Number(w.e.totalDebit) })
  }
  return out
}

/**
 * Till sales re-booked as customer invoices (POS/0017: Dr receivables /
 * Cr revenue on 4 Oct) with the till receipt never booked, so the customer
 * shows as owing money paid at the till. The receipt is recorded and booked
 * on the sale date with the till's payment method.
 */
async function findTillSalesBookedAsInvoices(): Promise<TillAsInvoice[]> {
  const docs = await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: 'POS/' }, status: { in: [...POSTED] }, NOT: { totalAmount: 0 } },
    select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true },
  })
  if (!docs.length) return []
  const entries = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: docs.map(d => d.id) }, isPosted: true },
    select: { invoiceId: true, ref: true, sourceType: true, isReversed: true, reversalOfId: true, lines: { where: { accountLabel: { startsWith: '1800' } }, select: { debit: true, credit: true } } },
  })
  const payments = new Set((await prisma.payment.findMany({ where: { invoiceId: { in: docs.map(d => d.id) }, isVoided: false }, select: { invoiceId: true } })).map(p => p.invoiceId))
  const tickets = (await import('@/lib/server-store')).loadAppState
  const raw = (await tickets(['deed_posOrders'])).deed_posOrders
  const methodOf = new Map((Array.isArray(raw) ? raw as Array<Record<string, any>> : []).map(t => [String(t.ref), String(t.payment ?? 'cash')]))
  const out: TillAsInvoice[] = []
  for (const d of docs) {
    if (payments.has(d.id)) continue
    const list = entries.filter(e => e.invoiceId === d.id)
    const salesAsInvoice = list.some(e => !e.isReversed && !e.reversalOfId && e.sourceType === 'invoice' && isPostingRef(e.ref, d.invoiceNumber) && e.lines.some(l => Number(l.debit) > 0))
    const arNet = list.reduce((s, e) => s + e.lines.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0), 0)
    if (!salesAsInvoice || Math.abs(arNet - Number(d.totalAmount)) > 0.01) continue
    const m = (methodOf.get(d.invoiceNumber) ?? 'cash').toLowerCase()
    out.push({
      invoiceId: d.id, ref: d.invoiceNumber, date: d.invoiceDate ? d.invoiceDate.toISOString().slice(0, 10) : '',
      total: Number(d.totalAmount),
      method: m.includes('mpesa') ? 'mpesa' : m.includes('card') ? 'card' : m.includes('bank') ? 'bank_transfer' : 'cash',
    })
  }
  return out
}

async function findUnlinkedReversals(): Promise<UnlinkedReversal[]> {
  const revs = await prisma.journalEntry.findMany({
    where: { ref: { startsWith: 'REV/' }, reversalOfId: null, isReversed: false },
    select: { id: true, ref: true, totalDebit: true, invoiceId: true, isReversed: true, reversalOfId: true },
  })
  if (!revs.length) return []
  const originals = await prisma.journalEntry.findMany({
    where: { ref: { in: revs.map(r => r.ref.slice(4)) } },
    select: { id: true, ref: true, totalDebit: true, invoiceId: true, isReversed: true, reversalOfId: true },
  })
  return planUnlinkedReversals([...revs, ...originals].map(e => ({
    id: e.id, ref: e.ref, total: Number(e.totalDebit), invoiceId: e.invoiceId, isReversed: e.isReversed, reversalOfId: e.reversalOfId,
  })))
}

/**
 * Bills whose live posting entry is a SALES entry (Dr 1800 receivables,
 * Cr 5000 revenue): BILL/2026/0008 was booked that way on 5 Aug, so a supplier
 * bill showed as revenue and as money owed to us, and never as money we owe.
 */
async function findBillsBookedAsSales(): Promise<BillAsSale[]> {
  const entries = await prisma.journalEntry.findMany({
    where: { isPosted: true, isReversed: false, reversalOfId: null, sourceType: 'invoice', invoiceId: { not: null },
      lines: { some: { accountLabel: { startsWith: '1800' }, debit: { gt: 0 } } } },
    select: { ref: true, totalDebit: true, invoiceId: true },
  })
  if (!entries.length) return []
  const bills = await prisma.invoice.findMany({
    where: { id: { in: entries.map(e => e.invoiceId!) }, documentType: 'vendor_bill' },
    select: { id: true, invoiceNumber: true },
  })
  const byId = new Map(bills.map(b => [b.id, b]))
  return entries
    .filter(e => byId.has(e.invoiceId!) && isPostingRef(e.ref, byId.get(e.invoiceId!)!.invoiceNumber))
    .map(e => ({ invoiceId: e.invoiceId!, ref: byId.get(e.invoiceId!)!.invoiceNumber, journalRef: e.ref, amount: Number(e.totalDebit) }))
    .sort((a, b) => a.ref.localeCompare(b.ref))
}

export async function findDocumentLedgerRepairs(): Promise<{ extraPayments: ExtraPaymentPlan[]; unbooked: UnbookedDoc[]; review: ReviewDoc[]; unlinkedReversals: UnlinkedReversal[]; billsAsSales: BillAsSale[]; stalePostings: StalePosting[]; misattached: Misattached[]; tillAsInvoice: TillAsInvoice[] }> {
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
    const base = { invoiceId: d.id, ref: d.invoiceNumber, kind, total, paid: Number(d.amountPaid) }

    const livePosting = list.some(e => !e.isReversed && !e.reversalOfId && ['invoice', 'bill'].includes(String(e.sourceType)) && isPostingRef(e.ref, d.invoiceNumber))
    if (!livePosting && Math.abs(booked) < 1 && !String(d.internalNotes ?? '').includes(OPENING_BALANCE_MARKER) && !d.invoiceNumber.startsWith('POS')) {
      unbooked.push({ ...base, date: d.invoiceDate ? d.invoiceDate.toISOString().slice(0, 10) : '' })
    }

    const plan = planExtraPaymentEntries({ invoiceId: d.id, ref: d.invoiceNumber, payments, entries: livePay })
    if (plan) extraPayments.push(plan)
    const after = money(ledgerPaid - (plan?.reverse.reduce((s, r) => s + r.amount, 0) ?? 0))
    if (recorded < 0.5 && ledgerPaid > 0.5) review.push({ ...base, ledgerPaid, reason: 'Ledger has payment entries but no payment is recorded on the document', action: 'record_payment' })
    else if (after > recorded + 0.5) review.push({ ...base, ledgerPaid: after, reason: 'Ledger payments exceed recorded payments by an amount that is not a copy' })
    else if (recorded > ledgerPaid + 0.5) review.push({ ...base, ledgerPaid, reason: 'Payment recorded on the document but not in the ledger', action: 'book_payment' })
  }
  const byRef = (a: { ref: string }, b: { ref: string }) => a.ref.localeCompare(b.ref)
  const misattached = await findMisattachedPostings()
  // A document about to receive its own entry back is not "unbooked".
  const receiving = new Set(misattached.map(m => m.toInvoiceId))
  return {
    extraPayments: extraPayments.sort(byRef), unbooked: unbooked.filter(u => !receiving.has(u.invoiceId)).sort(byRef), review: review.sort(byRef),
    unlinkedReversals: await findUnlinkedReversals(), billsAsSales: await findBillsBookedAsSales(),
    stalePostings: await findStalePostings(), misattached, tillAsInvoice: await findTillSalesBookedAsInvoices(),
  }
}

type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

export async function applyDocumentLedgerRepairs(actorId: string): Promise<Result[]> {
  const results: Result[] = []
  // 1. Record which entry each browser-posted reversal reversed (no balance changes).
  for (const r of await findUnlinkedReversals()) {
    try {
      await prisma.$transaction(async tx => {
        await tx.journalEntry.update({ where: { id: r.originalId }, data: { isReversed: true } })
        await tx.journalEntry.update({ where: { id: r.reversalId }, data: { reversalOfId: r.originalId } })
        await writeFinancialAuditInTx(tx, {
          userId: actorId,
          action: 'link_unlinked_reversal',
          entityType: 'journal_entry',
          entityId: r.originalId,
          relatedJournalId: r.reversalId,
          oldValues: { originalRef: r.originalRef, isReversed: false, reversalRef: r.reversalRef, reversalOfId: null },
          newValues: { isReversed: true, reversalOfId: r.originalId },
        })
      })
      results.push({ ref: r.originalRef, status: 'fixed', message: `Marked as reversed by ${r.reversalRef} (no balance change)` })
    } catch (err) {
      results.push({ ref: r.originalRef, status: 'failed', message: err instanceof Error ? err.message : 'could not link' })
    }
  }
  // 2. Bills booked as sales: reverse the sales entry and book the bill properly.
  for (const b of await findBillsBookedAsSales()) {
    try {
      const rev = await reverseJournalEntry(b.journalRef, actorId)
      const out = await ensureInvoiceBooked(b.invoiceId, actorId)
      await writeFinancialAudit({
        userId: actorId,
        action: 'rebook_bill_booked_as_sale',
        entityType: 'invoice',
        entityId: b.invoiceId,
        relatedJournalId: rev.id,
        oldValues: { journalRef: b.journalRef, booking: 'sale (Dr receivables / Cr revenue)' },
        newValues: { reversedBy: rev.ref, journalRef: out.ref },
      })
      results.push({ ref: b.ref, status: 'fixed', message: `Sales entry reversed; booked as a bill (${out.ref})` })
    } catch (err) {
      results.push({ ref: b.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not rebook' })
    }
  }
  // 3. A posting entry on the wrong document: move it to the one it names (no balance change).
  for (const m of await findMisattachedPostings()) {
    try {
      await prisma.$transaction(async tx => {
        await tx.journalEntry.update({ where: { id: m.journalId }, data: { invoiceId: m.toInvoiceId, sourceId: m.toInvoiceId } })
        await tx.invoice.update({ where: { id: m.toInvoiceId }, data: { postingStatus: 'posted', postedJournalEntryId: m.journalId } })
        await writeFinancialAuditInTx(tx, {
          userId: actorId, action: 'reattach_posting_entry', entityType: 'journal_entry', entityId: m.journalId,
          oldValues: { journalRef: m.journalRef, document: m.fromRef }, newValues: { document: m.toRef },
        })
      })
      results.push({ ref: m.toRef, status: 'fixed', message: `${m.journalRef} moved from ${m.fromRef} to ${m.toRef} (no balance change)` })
    } catch (err) {
      results.push({ ref: m.toRef, status: 'failed', message: err instanceof Error ? err.message : 'could not move' })
    }
  }
  // 4. Edited after booking: reverse the old amount, book the current one.
  for (const s of await findStalePostings()) {
    try {
      const out = await ensureInvoiceBooked(s.invoiceId, actorId)
      await writeFinancialAudit({
        userId: actorId, action: 'rebook_edited_document', entityType: 'invoice', entityId: s.invoiceId,
        oldValues: { journalRef: s.journalRef, booked: s.booked }, newValues: { journalRef: out.ref, total: s.total },
      })
      results.push({ ref: s.ref, status: 'fixed', message: `Re-booked at KES ${Math.round(s.total).toLocaleString('en-KE')} (was ${Math.round(s.booked).toLocaleString('en-KE')})` })
    } catch (err) {
      results.push({ ref: s.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not re-book' })
    }
  }
  // 5. Till sales booked as invoices: record and book the till receipt.
  for (const t of await findTillSalesBookedAsInvoices()) {
    try {
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: t.invoiceId }, include: { client: { select: { name: true } } } })
      const paidAt = new Date(`${t.date}T12:00:00Z`)
      const payment = await prisma.payment.create({
        data: {
          invoiceId: t.invoiceId, amount: t.total, amountBase: t.total, paymentType: 'customer_receipt',
          partnerId: invoice.clientId, paymentMethod: t.method as never, paidAt,
          reference: `Till ${t.ref}`, notes: 'Till receipt recorded in Integrity controls (sale was re-booked as an invoice)',
          idempotencyKey: `till-receipt:${t.invoiceId}`, createdById: actorId,
          allocations: { create: { invoiceId: t.invoiceId, amount: t.total, applicationDate: paidAt } },
        },
      })
      const journal = await postInvoicePaymentJournalToPrisma({
        invoice: { id: invoice.id, ref: invoice.invoiceNumber, invoiceNumber: invoice.invoiceNumber, type: 'customer_invoice', partnerName: invoice.client?.name ?? undefined } as never,
        amount: t.total, paymentId: payment.id, method: t.method, createdById: actorId, date: t.date,
      })
      await prisma.payment.update({ where: { id: payment.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
      await writeFinancialAudit({
        userId: actorId, action: 'book_till_receipt', entityType: 'invoice', entityId: t.invoiceId, relatedJournalId: journal.id,
        oldValues: { payment: null }, newValues: { paymentId: payment.id, amount: t.total, method: t.method },
      })
      results.push({ ref: t.ref, status: 'fixed', message: `Till receipt of KES ${Math.round(t.total).toLocaleString('en-KE')} (${t.method}) booked` })
    } catch (err) {
      results.push({ ref: t.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not book the receipt' })
    }
  }
  // 6. With those settled, the rest reads the current state.
  const { extraPayments, unbooked } = await findDocumentLedgerRepairs()
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

const methodFromAccount = (label: string): 'cash' | 'mpesa' | 'bank_transfer' | 'credit' => {
  const l = label.toLowerCase()
  if (l.startsWith('3313') || l.includes('credit')) return 'credit'
  if (l.includes('mpesa') || l.includes('m-pesa') || l.includes('mobile')) return 'mpesa'
  if (l.startsWith('22') && l.includes('bank')) return 'bank_transfer'
  return 'cash'
}

const isPayRef = (ref: string) => ref.startsWith('JRN/PAY')

/** Add the payment record for each live payment entry that has none. */
async function recordMissingPayments(invoiceId: string, actorId: string): Promise<string> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, documentType: true, clientId: true, totalAmount: true, amountPaid: true } })
  const isBill = invoice.documentType === 'vendor_bill'
  const own = isBill ? '3000' : '1800'
  const entries = await prisma.journalEntry.findMany({
    where: { invoiceId, isPosted: true, isReversed: false, reversalOfId: null },
    select: { id: true, ref: true, paymentId: true, entryDate: true, lines: { select: { accountLabel: true, debit: true, credit: true } } },
  })
  const livePayments = new Set((await prisma.payment.findMany({ where: { invoiceId, isVoided: false }, select: { id: true } })).map(p => p.id))
  let added = 0
  let total = 0
  for (const e of entries.filter(x => isPayRef(x.ref) && !(x.paymentId && livePayments.has(x.paymentId)))) {
    const ownLines = e.lines.filter(l => l.accountLabel.startsWith(own))
    const amount = money(ownLines.reduce((s, l) => s + (isBill ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit)), 0))
    if (!(amount > 0)) continue
    const counter = e.lines.find(l => !l.accountLabel.startsWith(own))?.accountLabel ?? ''
    await prisma.$transaction(async tx => {
      const payment = await tx.payment.create({
        data: {
          invoiceId, amount, amountBase: amount,
          paymentType: isBill ? 'vendor_payment' : 'customer_receipt',
          partnerId: invoice.clientId,
          journalId: e.id,
          idempotencyKey: `ledger-entry:${e.id}`,
          postingStatus: 'posted',
          paymentMethod: methodFromAccount(counter),
          reference: e.ref.slice(0, 80),
          paidAt: e.entryDate,
          notes: `Recorded from ledger entry ${e.ref} (approved in Integrity controls)`,
          createdById: actorId,
          allocations: { create: { invoiceId, amount, applicationDate: e.entryDate } },
        },
      })
      await tx.journalEntry.update({ where: { id: e.id }, data: { paymentId: payment.id } })
      await writeFinancialAuditInTx(tx, {
        userId: actorId,
        action: 'record_payment_from_ledger_entry',
        entityType: 'invoice',
        entityId: invoiceId,
        relatedJournalId: e.id,
        oldValues: { payment: null, journalRef: e.ref },
        newValues: { paymentId: payment.id, amount },
      })
    })
    added++
    total = money(total + amount)
  }
  if (!added) throw new Error('No payment entry without a payment record was found')
  // The document's paid figure follows its payments.
  const recorded = await prisma.paymentAllocation.aggregate({ where: { invoiceId, reversedAt: null, payment: { isVoided: false } }, _sum: { amount: true } })
  const paid = Math.min(Number(recorded._sum.amount ?? 0), Math.abs(Number(invoice.totalAmount)))
  if (paid > Number(invoice.amountPaid) + 0.005) await prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid } })
  return `${added} payment record${added === 1 ? '' : 's'} added (KES ${Math.round(total).toLocaleString('en-KE')})`
}

/** Post the entry for each recorded payment the ledger lacks. */
async function bookMissingPaymentEntries(invoiceId: string, actorId: string): Promise<string> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { client: { select: { name: true } } } })
  const payments = await prisma.payment.findMany({
    where: { isVoided: false, OR: [{ invoiceId }, { allocations: { some: { invoiceId, reversedAt: null } } }] },
    include: { allocations: { where: { invoiceId, reversedAt: null } } },
  })
  const live = await prisma.journalEntry.findMany({
    where: { invoiceId, isReversed: false, reversalOfId: null },
    select: { id: true, ref: true, paymentId: true },
  })
  let booked = 0
  let total = 0
  for (const p of payments) {
    const has = live.some(e => e.paymentId === p.id || e.id === p.journalId || (isPayRef(e.ref) && e.ref.endsWith(`/${p.id}`)))
    if (has) continue
    const amount = money(p.allocations.length ? p.allocations.reduce((s, a) => s + Number(a.amount), 0) : Number(p.amount))
    if (!(amount > 0)) continue
    let ref = `JRN/PAY/${invoice.invoiceNumber}/${p.id}`.slice(0, 80)
    for (let n = 2; await prisma.journalEntry.findUnique({ where: { ref }, select: { id: true } }); n++) {
      ref = `JRN/PAY/${invoice.invoiceNumber}/${p.id.slice(0, 8)}/R${n}`.slice(0, 80)
    }
    const journal = await postInvoicePaymentJournalToPrisma({
      invoice: {
        id: invoice.id, ref: invoice.invoiceNumber, invoiceNumber: invoice.invoiceNumber,
        type: invoice.documentType === 'vendor_bill' ? 'vendor_bill' : 'customer_invoice',
        partnerName: invoice.client?.name ?? undefined,
      } as never,
      amount, paymentId: p.id, method: p.paymentMethod, createdById: actorId,
      ref, date: p.paidAt.toISOString().slice(0, 10),
    })
    await prisma.payment.update({ where: { id: p.id }, data: { journalId: journal.id, postingStatus: 'posted' } })
    await writeFinancialAudit({
      userId: actorId,
      action: 'book_missing_payment_entry',
      entityType: 'invoice',
      entityId: invoiceId,
      relatedJournalId: journal.id,
      oldValues: { paymentId: p.id, journal: null },
      newValues: { journalRef: journal.ref, amount },
    })
    booked++
    total = money(total + amount)
  }
  if (!booked) throw new Error('Every recorded payment already has a ledger entry')
  return `${booked} payment entr${booked === 1 ? 'y' : 'ies'} booked (KES ${Math.round(total).toLocaleString('en-KE')})`
}

/** Apply the review rows a director approved, re-checked against current data. */
export async function approveReviewRows(invoiceIds: string[], actorId: string): Promise<Result[]> {
  const { review } = await findDocumentLedgerRepairs()
  const results: Result[] = []
  for (const id of invoiceIds) {
    const row = review.find(r => r.invoiceId === id)
    if (!row?.action) { results.push({ ref: row?.ref ?? id, status: 'failed', message: 'No longer needs this correction, or has no automatic correction' }); continue }
    try {
      const message = row.action === 'record_payment' ? await recordMissingPayments(id, actorId) : await bookMissingPaymentEntries(id, actorId)
      results.push({ ref: row.ref, status: 'fixed', message })
    } catch (err) {
      results.push({ ref: row.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not correct' })
    }
  }
  return results
}
