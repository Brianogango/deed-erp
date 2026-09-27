import 'server-only'
import prisma from '@/lib/prisma'
import { PRISMA_POSTED_INVOICE_STATUSES } from '@/lib/finance-invoice'
import {
  allocateInvoiceJournalRef,
  buildInvoiceJournalInput,
} from '@/lib/accounting/invoice-journals'
import { createJournalEntry } from '@/lib/accounting/journal-service'
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

export type OrphanedInvoice = {
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
 * Is this row an invoice the ledger has lost?
 *
 * Pure, and separate from the query, because this predicate is the definition
 * of the defect and wants tests of its own. `posting` is a transient state the
 * PUT route sets inside its transaction, so it is NOT an orphan — treating it
 * as one would race a posting that is still in flight.
 */
export function isOrphanedPostedInvoice(row: {
  status: string
  postingStatus: string
}): boolean {
  if (!PRISMA_POSTED_INVOICE_STATUSES.has(String(row.status))) return false
  return String(row.postingStatus) === 'unposted'
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

  const orphans = candidates.filter(row =>
    isOrphanedPostedInvoice({ status: String(row.status), postingStatus: row.postingStatus }),
  )
  if (orphans.length === 0) return []

  // Which journal was reversed, for the operator's benefit. An invoice with no
  // journal at all is still an orphan — it never reached the ledger either —
  // so a missing row here is reported, not filtered out.
  const journals = await prisma.journalEntry.findMany({
    where: { invoiceId: { in: orphans.map(o => o.id) }, isReversed: true },
    select: { invoiceId: true, ref: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const byInvoice = new Map<string, { ref: string; createdAt: Date }>()
  for (const j of journals) {
    if (j.invoiceId && !byInvoice.has(j.invoiceId)) byInvoice.set(j.invoiceId, { ref: j.ref, createdAt: j.createdAt })
  }

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
}): Promise<RepostOutcome> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.invoiceId },
    include: { items: true },
  })
  if (!invoice) return { kind: 'skipped', invoiceNumber: params.invoiceId, reason: 'Invoice not found' }

  const label = invoice.invoiceNumber

  // Re-check under current state: the list the operator saw may be minutes old
  // and someone may have posted it in between.
  if (!isOrphanedPostedInvoice({ status: String(invoice.status), postingStatus: invoice.postingStatus })) {
    return {
      kind: 'skipped',
      invoiceNumber: label,
      reason: `No longer orphaned (status ${invoice.status}, posting ${invoice.postingStatus})`,
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
  await prisma.taxTransaction.updateMany({
    where: { sourceType: type === 'vendor_bill' ? 'vendor_bill' : 'invoice', sourceId: invoice.id },
    data: { journalEntryId: journal.id },
  })

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
