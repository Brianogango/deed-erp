import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { recordInvoiceTax } from '@/lib/accounting/invoice-tax.server'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { planCreditApplicationDuplicates, planDepositDuplicates, type CreditApplicationDuplicate, type CreditEntry, type DepositDuplicate } from '@/lib/accounting/ledger-cleanup'
import { loadAppState } from '@/lib/server-store'
import { addInvoicesToList } from '@/lib/documents-broadcast.server'

type VatGap = { invoiceId: string; ref: string; type: string; vat: number; journalId: string }

type ListGap = { ref: string; date: string; total: number }
type TillGap = { ref: string; date: string; total: number; customer: string; cashier: string; inLedger: boolean }

type Row = Record<string, any>
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''))

/**
 * Till sales whose invoice never reached the database (POS/0096): the ticket
 * and the till's ledger entry exist, so the money is booked, but with no
 * invoice Finance cannot list it. Tickets of KES 0 are left alone.
 */
async function findTillSalesWithoutInvoice(): Promise<Array<TillGap & { ticket: Row }>> {
  const raw = (await loadAppState(['deed_posOrders'])).deed_posOrders
  const tickets = (Array.isArray(raw) ? raw as Row[] : []).filter(t => t?.ref && Number(t.total) > 0)
  if (!tickets.length) return []
  const have = await prisma.invoice.findMany({
    where: { OR: [{ invoiceNumber: { in: tickets.map(t => String(t.ref)) } }, { id: { in: tickets.map(t => String(t.invoiceId ?? '')).filter(uuid) } }] },
    select: { id: true, invoiceNumber: true },
  })
  const ids = new Set(have.map(h => h.id))
  const refs = new Set(have.map(h => h.invoiceNumber))
  const missing = tickets.filter(t => !refs.has(String(t.ref)) && !ids.has(String(t.invoiceId ?? '')))
  const ledger = new Set((await prisma.journalEntry.findMany({
    where: { ref: { in: missing.map(t => `JRN/${t.ref}`) }, isReversed: false },
    select: { ref: true },
  })).map(j => j.ref))
  return missing.map(t => ({
    ref: String(t.ref),
    date: String(t.date ?? t.createdAt ?? '').slice(0, 10),
    total: Number(t.total),
    customer: String(t.customerName ?? 'Walk-in Customer'),
    cashier: String(t.createdByName ?? ''),
    inLedger: ledger.has(`JRN/${t.ref}`),
    ticket: t,
  })).sort((a, b) => b.date.localeCompare(a.date))
}

/** The invoice the till would have saved, from its ticket. */
async function invoiceFromTicket(t: Row): Promise<Row> {
  const lines = Array.isArray(t.lines) ? t.lines as Row[] : []
  const productIds = lines.map(l => String(l.productId ?? '')).filter(uuid)
  const known = new Set((await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })).map(p => p.id))
  const taxRate = Number(t.taxTotal) > 0 && Number(t.subtotal) > 0 ? Math.round((Number(t.taxTotal) / Number(t.subtotal)) * 100) : 0
  const date = String(t.date ?? t.createdAt ?? '').slice(0, 10)
  return {
    id: uuid(t.invoiceId) ? t.invoiceId : undefined,
    ref: String(t.ref),
    invoiceNumber: String(t.ref),
    type: 'customer_invoice',
    status: 'posted',
    partnerId: t.customerId ?? 'walk-in',
    partnerName: t.customerName ?? 'Walk-in Customer',
    date, invoiceDate: date, dueDate: date,
    lines: lines.map(l => {
      const qty = Number(l.qty) || 1
      const unitPrice = Number(l.price ?? l.unitPrice ?? 0)
      return {
        description: l.serialNumber ? `${l.productName} ×${qty} · SN ${l.serialNumber}` : `${l.productName ?? 'Item'} ×${qty}`,
        qty,
        unitPrice,
        taxRate,
        subtotal: Number(l.subtotal ?? unitPrice * qty),
        productId: known.has(String(l.productId)) ? l.productId : undefined,
      }
    }),
    subtotal: Number(t.subtotal ?? t.total),
    taxTotal: Number(t.taxTotal ?? 0),
    total: Number(t.total),
    amountPaid: Number(t.total),
    notes: [`POS ${t.ref}`, t.paymentReference ? `Ref ${t.paymentReference}` : '', 'Invoice rebuilt from the till ticket'].filter(Boolean).join(' · '),
    isPosInvoice: true,
  }
}

/** Documents in the invoices table that the Finance list does not show. */
async function findMissingFromList(): Promise<ListGap[]> {
  const raw = (await loadAppState(['deed_invoices'])).deed_invoices
  const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const ids = new Set(rows.map(r => String(r?.id ?? '')))
  const refs = new Set(rows.map(r => String(r?.ref ?? '')))
  const all = await prisma.invoice.findMany({ select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true } })
  return all
    .filter(i => !ids.has(i.id) && !refs.has(i.invoiceNumber))
    .map(i => ({ ref: i.invoiceNumber, date: i.invoiceDate ? i.invoiceDate.toISOString().slice(0, 10) : '', total: Number(i.totalAmount) }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Credit applications booked twice (browser JRN/CAPP copy + server payment entry). */
async function findCreditApplicationDuplicates(): Promise<{ reverse: Array<CreditApplicationDuplicate & { invoiceRef: string }>; unpaired: Array<CreditEntry & { invoiceRef: string }> }> {
  const live = { isPosted: true, isReversed: false, reversalOfId: null }
  const browser = await prisma.journalEntry.findMany({
    where: { ...live, ref: { startsWith: 'JRN/CAPP/' }, invoiceId: { not: null } },
    select: { ref: true, invoiceId: true, totalDebit: true },
  })
  if (!browser.length) return { reverse: [], unpaired: [] }
  const invoiceIds = [...new Set(browser.map(b => b.invoiceId!))]
  const server = await prisma.journalEntry.findMany({
    where: { ...live, ref: { startsWith: 'JRN/PAY/' }, invoiceId: { in: invoiceIds }, lines: { some: { accountLabel: { startsWith: '3313' }, debit: { gt: 0 } } } },
    select: { ref: true, invoiceId: true, totalDebit: true },
  })
  const refs = new Map((await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNumber: true } })).map(i => [i.id, i.invoiceNumber]))
  const asEntry = (e: { ref: string; invoiceId: string | null; totalDebit: unknown }) => ({ ref: e.ref, invoiceId: e.invoiceId!, amount: Number(e.totalDebit) })
  const plan = planCreditApplicationDuplicates(browser.map(asEntry), server.map(asEntry))
  return {
    reverse: plan.reverse.map(r => ({ ...r, invoiceRef: refs.get(r.invoiceId) ?? '' })),
    unpaired: plan.unpaired.map(r => ({ ...r, invoiceRef: refs.get(r.invoiceId) ?? '' })),
  }
}

export async function findLedgerCleanup(): Promise<{ deposits: DepositDuplicate[]; vat: VatGap[]; listMissing: ListGap[]; tillMissing: TillGap[]; creditCopies: Array<CreditApplicationDuplicate & { invoiceRef: string }>; creditUnpaired: Array<CreditEntry & { invoiceRef: string }> }> {
  const depositEntries = await prisma.journalEntry.findMany({
    where: {
      isPosted: true, isReversed: false, reversalOfId: null,
      OR: [{ ref: { startsWith: 'JRN/DEP/' } }, { ref: { startsWith: 'JRN/REFUND/' } }],
    },
    select: { ref: true, sourceType: true, totalDebit: true, entryDate: true },
  })
  const deposits = planDepositDuplicates(depositEntries.map(e => ({
    ref: e.ref, sourceType: e.sourceType, amount: Number(e.totalDebit), date: e.entryDate.toISOString().slice(0, 10),
  })))

  const taxed = await prisma.invoice.findMany({
    where: { taxAmount: { gt: 0 }, status: { notIn: ['draft', 'cancelled', 'voided'] } },
    select: { id: true, invoiceNumber: true, documentType: true, taxAmount: true },
  })
  const postings = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: taxed.map(i => i.id) }, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
    select: { id: true, ref: true, invoiceId: true },
  })
  const withTax = new Set((await prisma.taxTransaction.findMany({
    where: { sourceId: { in: taxed.map(i => i.id) } }, select: { sourceId: true }, distinct: ['sourceId'],
  })).map(t => t.sourceId))
  const vat: VatGap[] = []
  for (const inv of taxed) {
    if (withTax.has(inv.id)) continue
    const posting = postings.find(j => j.invoiceId === inv.id && isPostingRef(j.ref, inv.invoiceNumber))
    if (!posting) continue
    vat.push({ invoiceId: inv.id, ref: inv.invoiceNumber, type: String(inv.documentType), vat: Number(inv.taxAmount), journalId: posting.id })
  }
  const tillMissing = (await findTillSalesWithoutInvoice()).map(({ ticket: _ticket, ...gap }) => gap)
  const credit = await findCreditApplicationDuplicates()
  return { deposits, vat: vat.sort((a, b) => a.ref.localeCompare(b.ref)), listMissing: await findMissingFromList(), tillMissing, creditCopies: credit.reverse, creditUnpaired: credit.unpaired }
}

type Result = { ref: string; status: 'fixed' | 'failed'; message: string }

export async function applyLedgerCleanup(actorId: string): Promise<Result[]> {
  const { deposits, vat, listMissing, creditCopies } = await findLedgerCleanup()
  const results: Result[] = []
  for (const c of creditCopies) {
    try {
      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { ref: c.ref }, select: { id: true } })
      const rev = await reverseJournalEntry(c.ref, actorId)
      await writeFinancialAudit({
        userId: actorId,
        action: 'reverse_duplicate_credit_application',
        entityType: 'invoice',
        entityId: c.invoiceId,
        relatedJournalId: rev.id,
        oldValues: { journalRef: c.ref, journalId: original.id, amount: c.amount },
        newValues: { reversedBy: rev.ref, kept: c.keeps },
      })
      results.push({ ref: c.invoiceRef || c.ref, status: 'fixed', message: `Credit applied twice: reversed ${c.ref} (KES ${Math.round(c.amount).toLocaleString('en-KE')}), kept ${c.keeps}` })
    } catch (err) {
      results.push({ ref: c.invoiceRef || c.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not reverse' })
    }
  }
  for (const d of deposits) {
    try {
      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { ref: d.ref }, select: { id: true } })
      const rev = await reverseJournalEntry(d.ref, actorId)
      await writeFinancialAudit({
        userId: actorId,
        action: 'reverse_duplicate_deposit_journal',
        entityType: 'journal_entry',
        entityId: original.id,
        relatedJournalId: rev.id,
        oldValues: { ref: d.ref, amount: d.amount },
        newValues: { reversedBy: rev.ref, kept: d.keeps },
      })
      results.push({ ref: d.ref, status: 'fixed', message: `Reversed (duplicate of ${d.keeps})` })
    } catch (err) {
      results.push({ ref: d.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not reverse' })
    }
  }
  for (const g of vat) {
    try {
      await recordInvoiceTax(g.invoiceId, g.journalId)
      results.push({ ref: g.ref, status: 'fixed', message: `VAT record written (KES ${Math.round(g.vat).toLocaleString('en-KE')})` })
    } catch (err) {
      results.push({ ref: g.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not write VAT record' })
    }
  }
  // Till sales with no invoice: saved through the normal invoice route (a
  // till invoice posts no entry there — the till's own entry already did).
  const tills = await findTillSalesWithoutInvoice()
  if (tills.length) {
    const { POST: createInvoice } = await import('@/app/api/invoices/route')
    for (const gap of tills) {
      try {
        const res = await createInvoice(new Request('http://internal/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(await invoiceFromTicket(gap.ticket)),
        }))
        const body = await res.json().catch(() => null) as { error?: string } | null
        results.push(res.ok
          ? { ref: gap.ref, status: 'fixed', message: `Invoice rebuilt from the till ticket${gap.inLedger ? '' : ' — the till entry is missing from the ledger too'}` }
          : { ref: gap.ref, status: 'failed', message: body?.error || `server returned ${res.status}` })
      } catch (err) {
        results.push({ ref: gap.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not rebuild' })
      }
    }
  }
  if (listMissing.length || tills.length) {
    try {
      const added = await addInvoicesToList()
      for (const ref of added) results.push({ ref, status: 'fixed', message: 'Added to the Finance list' })
    } catch (err) {
      results.push({ ref: 'Finance list', status: 'failed', message: err instanceof Error ? err.message : 'could not update the list' })
    }
  }
  return results
}
