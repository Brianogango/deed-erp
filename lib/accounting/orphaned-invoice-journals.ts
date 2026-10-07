import 'server-only'
import { OPENING_BALANCE_MARKER } from '@/lib/finance/opening-balance'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import prisma from '@/lib/prisma'
import { PRISMA_POSTED_INVOICE_STATUSES } from '@/lib/finance-invoice'
import {
  allocateInvoiceJournalRef,
  buildInvoiceJournalInput,
} from '@/lib/accounting/invoice-journals'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { recordInvoiceTax } from '@/lib/accounting/invoice-tax.server'
import { resolveBlobInvoiceMirror } from '@/lib/accounting/resolve-invoice-mirror'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { writeFinancialAudit } from '@/lib/finance-audit'

/**
 * Invoices that the business considers posted but that the ledger has lost.
 *
 * Until 2026-09-27 the PUT route could not tell a deliberate Reset to Draft
 * from an ordinary save sent by a browser tab that had never seen the invoice
 * get posted — both arrive saying `status: 'draft'`. It executed the stale one
 * as a reversal: the GL journal reversed, postingStatus back to `unposted`,
 * postedJournalEntryId cleared. Nobody was told, because those callers discard
 * the response.
 *
 * The invoice then sits in a posted status with no live journal. Revenue and
 * output VAT were never recognised; any receipt against it still credits AR,
 * so the customer's AR balance goes negative by the amount paid. Nothing in
 * the system looked for that state — the integrity suite checked for unposted
 * JOURNALS, not for invoices that had lost theirs, which is why three August
 * invoices sat this way for six weeks.
 *
 * Re-posting is the remedy rather than a hand-written correcting entry:
 * buildInvoiceJournalInput recomputes revenue, VAT and COGS from the invoice
 * itself using current logic, and allocateInvoiceJournalRef gives the new
 * entry `JRN/INV/.../2` so the reversed original stays visible in the audit
 * trail instead of being overwritten.
 */

type OrphanedInvoice = {
  id: string
  invoiceNumber: string
  invoiceDate: Date
  status: string
  documentType: string
  totalAmount: number
  amountPaid: number
  reversedJournalRef: string | null
  reversedAt: Date | null
}

/**
 * Is this row an invoice the ledger LOST — as opposed to one it never had?
 *
 * The distinction is the whole predicate, and getting it wrong is expensive in
 * one direction only. An earlier version asked merely "posted in the app, no
 * live journal", which matched 291 invoices worth KES 9.68m instead of the 3
 * the defect actually stranded. Almost all of them predate the 13 Sep finance
 * cutover, from before there was a chart of accounts to post into: being absent
 * from the GL is their correct and expected state, and they are accounted for
 * in the opening balances taken on at the cutover. Re-posting them would have
 * double-counted a year of trading.
 *
 * What distinguishes a victim of the un-posting bug is that its journal was
 * REVERSED. It reached the ledger, then a stale tab's save took it out again.
 * No reversal means no journal was ever taken away, which means there is
 * nothing here to put back.
 *
 * `posting` is a transient state the PUT route sets inside its transaction, so
 * it is not an orphan either — treating it as one would race a posting that is
 * still in flight.
 */
export function isOrphanedPostedInvoice(row: {
  status: string
  postingStatus: string
  hasReversedJournal: boolean
}): boolean {
  if (!PRISMA_POSTED_INVOICE_STATUSES.has(String(row.status))) return false
  if (String(row.postingStatus) !== 'unposted') return false
  return row.hasReversedJournal === true
}

export async function findOrphanedPostedInvoices(): Promise<OrphanedInvoice[]> {
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: Array.from(PRISMA_POSTED_INVOICE_STATUSES) as any },
      postingStatus: 'unposted',
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      documentType: true,
      totalAmount: true,
      amountPaid: true,
      postingStatus: true,
    },
    orderBy: { invoiceDate: 'asc' },
  })

  if (candidates.length === 0) return []

  // The reversal is what identifies a victim, so this is a filter, not a
  // decoration. `REV/` entries are excluded: the reversal itself is not
  // reversed, and matching one would let any cancelled invoice in.
  // Only the invoice's OWN posting entry (JRN/<number>, JRN/<number>/N)
  // counts: a reversed payment (JRN/PAY/…) or delivery charge on the invoice
  // does not mean its revenue left the ledger. And an invoice that still has a
  // live posting entry has lost nothing.
  const numberOf = new Map(candidates.map(c => [c.id, c.invoiceNumber]))
  const journals = (await prisma.journalEntry.findMany({
    where: {
      invoiceId: { in: candidates.map(c => c.id) },
      NOT: { ref: { startsWith: 'REV/' } },
    },
    select: { invoiceId: true, ref: true, createdAt: true, isReversed: true, reversalOfId: true },
    orderBy: { createdAt: 'desc' },
  })).filter(j => j.invoiceId && isPostingRef(j.ref, numberOf.get(j.invoiceId) ?? ''))
  const stillLive = new Set(journals.filter(j => !j.isReversed && !j.reversalOfId).map(j => j.invoiceId))
  const byInvoice = new Map<string, { ref: string; createdAt: Date }>()
  for (const j of journals) {
    if (!j.isReversed || stillLive.has(j.invoiceId)) continue
    if (j.invoiceId && !byInvoice.has(j.invoiceId)) byInvoice.set(j.invoiceId, { ref: j.ref, createdAt: j.createdAt })
  }

  const orphans = candidates.filter(row =>
    isOrphanedPostedInvoice({
      status: String(row.status),
      postingStatus: row.postingStatus,
      hasReversedJournal: byInvoice.has(row.id),
    }),
  )

  return orphans.map(row => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    status: String(row.status),
    documentType: row.documentType,
    totalAmount: Number(row.totalAmount),
    amountPaid: Number(row.amountPaid),
    reversedJournalRef: byInvoice.get(row.id)?.ref ?? null,
    reversedAt: byInvoice.get(row.id)?.createdAt ?? null,
  }))
}

/**
 * Posted invoices that never had any ledger entry, for a director to look at.
 * Shown, never acted on by themselves: most such invoices predate the 13 Sep
 * cutover and belong to the opening balances. Only the ones a director names
 * explicitly (by number) can be posted — see repostOrphanedInvoice's
 * `namedNeverPosted`. The date filter here only trims the list for reading.
 */
export async function listNeverPostedSince(since: string) {
  const rows = await prisma.invoice.findMany({
    where: {
      status: { in: Array.from(PRISMA_POSTED_INVOICE_STATUSES) as any },
      postingStatus: 'unposted',
      invoiceDate: { gte: new Date(`${since}T00:00:00Z`) },
      NOT: { invoiceNumber: { startsWith: 'POS' } },
    },
    select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, documentType: true, internalNotes: true },
    orderBy: { invoiceDate: 'asc' },
  })
  if (!rows.length) return []
  const touched = new Set((await prisma.journalEntry.findMany({
    where: { invoiceId: { in: rows.map(r => r.id) } },
    select: { invoiceId: true },
  })).map(j => j.invoiceId))
  return rows
    .filter(r => !touched.has(r.id) && !String(r.internalNotes ?? '').includes(OPENING_BALANCE_MARKER))
    .map(r => ({ id: r.id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, totalAmount: Number(r.totalAmount), documentType: r.documentType }))
}

export type RepostOutcome =
  | { kind: 'reposted'; invoiceNumber: string; journalRef: string; journalId: string; entryDate: string }
  | { kind: 'skipped'; invoiceNumber: string; reason: string }

/**
 * Re-post one orphaned invoice.
 *
 * `entryDate` is required and has no default on purpose. Posting on the
 * original invoice date puts the revenue in the month the sale happened, which
 * is the substantively correct answer but reopens a closed period; posting
 * today keeps the close intact and misstates the month. That is an accounting
 * decision for whoever signs the books, not a default for this function to
 * pick, so the caller must state it and the fiscal lock still gets the last
 * word either way.
 */
export async function repostOrphanedInvoice(params: {
  invoiceId: string
  entryDate: Date
  /**
   * The director doing this. Null when the call is authorised by the internal
   * secret rather than a session — a maintenance run from the server itself,
   * which has no user behind it. The journal and the audit row are written
   * either way; an unattributed correction is far better than none, and the
   * audit action name records what happened.
   */
  actorId: string | null
  /**
   * The director named this invoice by number as one that never reached the
   * ledger and should. Allowed only when it has never had any entry at all.
   */
  namedNeverPosted?: boolean
}): Promise<RepostOutcome> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.invoiceId },
    include: { items: true },
  })
  if (!invoice) return { kind: 'skipped', invoiceNumber: params.invoiceId, reason: 'Invoice not found' }

  const label = invoice.invoiceNumber

  // Re-check under current state, including the reversal. The list the operator
  // saw may be minutes old and someone may have posted it in between — and this
  // function must refuse a pre-cutover invoice on its own account, not merely
  // because the caller filtered it out. Posting one of those would invent
  // revenue the opening balances already carry.
  const own = (await prisma.journalEntry.findMany({
    where: { invoiceId: invoice.id, NOT: { ref: { startsWith: 'REV/' } } },
    select: { ref: true, isReversed: true, reversalOfId: true },
  })).filter(j => isPostingRef(j.ref, invoice.invoiceNumber))
  const liveOwn = own.find(j => !j.isReversed && !j.reversalOfId)
  if (liveOwn) {
    return { kind: 'skipped', invoiceNumber: invoice.invoiceNumber, reason: `Already in the ledger (${liveOwn.ref})` }
  }
  const reversed = own.find(j => j.isReversed) ?? null
  // Any entry at all — sales, bill, opening balance (JRN/OB/…), live or
  // reversed — means the document is already accounted for somewhere.
  const anyEntry = params.namedNeverPosted
    ? await prisma.journalEntry.findFirst({ where: { invoiceId: invoice.id }, select: { ref: true } })
    : null
  const openingBalance = String(invoice.internalNotes ?? '').includes(OPENING_BALANCE_MARKER)
  if (params.namedNeverPosted && (anyEntry || openingBalance)) {
    return {
      kind: 'skipped',
      invoiceNumber: label,
      reason: openingBalance
        ? 'Opening-balance document — carried in the opening balances, not posted as a sale'
        : `Already in the ledger (${anyEntry!.ref})`,
    }
  }
  const namedAndNeverPosted = Boolean(params.namedNeverPosted)
    && PRISMA_POSTED_INVOICE_STATUSES.has(String(invoice.status))
    && invoice.postingStatus === 'unposted'
  if (!namedAndNeverPosted && !isOrphanedPostedInvoice({
    status: String(invoice.status),
    postingStatus: invoice.postingStatus,
    hasReversedJournal: Boolean(reversed),
  })) {
    return {
      kind: 'skipped',
      invoiceNumber: label,
      reason: reversed
        ? `No longer orphaned (status ${invoice.status}, posting ${invoice.postingStatus})`
        : 'Never had a GL journal to lose — not an un-posting victim, so re-posting it would invent revenue',
    }
  }

  const lock = await checkFiscalLock(params.entryDate)
  if (!lock.ok) return { kind: 'skipped', invoiceNumber: label, reason: lock.error ?? 'Fiscal period is locked' }

  const mirror = await resolveBlobInvoiceMirror(invoice.id)
  const type = invoice.documentType === 'vendor_bill' || mirror.type === 'vendor_bill'
    ? 'vendor_bill' as const
    : 'customer_invoice' as const

  const input = await buildInvoiceJournalInput({
    id: invoice.id,
    ref: invoice.invoiceNumber,
    invoiceNumber: invoice.invoiceNumber,
    // The journal's own date, which is the decision above. The invoice keeps
    // its own invoiceDate untouched — this re-post must not restate the
    // document, only put it back in the ledger.
    invoiceDate: params.entryDate,
    totalAmount: Number(invoice.totalAmount),
    subtotal: Number(invoice.subtotal),
    taxAmount: Number(invoice.taxAmount),
    type,
    repairId: invoice.repairId ?? undefined,
    purchaseOrderId: mirror.purchaseOrderId ?? undefined,
    partnerName: mirror.partnerName,
    clientName: mirror.clientName,
    lines: invoice.items.map(i => ({
      productId: i.productId ?? undefined,
      qty: Number(i.qty),
      unitPrice: Number(i.unitPrice),
      subtotal: Number(i.lineSubtotal),
      description: i.description,
    })),
  }, { createdById: params.actorId ?? undefined })

  // Takes `.../2` when the original is reversed, so the reversed entry stays
  // in place and the correction is legible as a separate event.
  input.ref = await allocateInvoiceJournalRef(input.ref)

  const journal = await createJournalEntry(input)

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      postingStatus: 'posted',
      postedJournalEntryId: journal.id,
      postedAt: new Date(),
      postedById: params.actorId,  // null is accepted: see actorId above
    },
  })

  // Re-point the VAT subledger at the new journal. The rows themselves survived
  // the reversal — nothing deletes tax_transactions when a journal is reversed
  // — so the return feed still carried these sales while the GL did not. This
  // is what makes the two agree again.
  // Invoices that never had them get them now.
  await recordInvoiceTax(invoice.id, journal.id)

  await writeFinancialAudit({
    userId: params.actorId,
    action: 'repost_orphaned_invoice',
    entityType: 'invoice',
    entityId: invoice.id,
    relatedJournalId: journal.id,
    oldValues: { postingStatus: 'unposted', postedJournalEntryId: null },
    newValues: { postingStatus: 'posted', journalRef: input.ref, entryDate: params.entryDate.toISOString().slice(0, 10) },
  })

  return {
    kind: 'reposted',
    invoiceNumber: label,
    journalRef: input.ref,
    journalId: journal.id,
    entryDate: params.entryDate.toISOString().slice(0, 10),
  }
}
