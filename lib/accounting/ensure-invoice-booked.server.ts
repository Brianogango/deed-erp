import 'server-only'

import prisma from '@/lib/prisma'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { postInvoiceJournalToPrisma } from '@/lib/accounting/invoice-journals'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { recordInvoiceTax } from '@/lib/accounting/invoice-tax.server'

/**
 * Make sure a confirmed invoice is in the ledger at its current amount.
 *
 * For server paths that create or change a confirmed invoice directly (the
 * customer portal's repair approval used to write `status: 'approved'` with no
 * ledger entry at all — INV/2026/0308). Idempotent:
 *  - booked at the right amount: only marks it posted;
 *  - booked at another amount (a re-approved quote): reverses that entry and
 *    books the current one;
 *  - not booked: books it.
 * Throws when it cannot post, so the caller can record the failure.
 */
export async function ensureInvoiceBooked(invoiceId: string, actorId?: string): Promise<{ ref: string; action: 'already' | 'booked' | 'rebooked' }> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true, client: { select: { name: true } } } })
  const total = Number(invoice.totalAmount)
  const live = (await prisma.journalEntry.findMany({
    where: { invoiceId, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
    select: { id: true, ref: true, totalDebit: true },
  })).filter(j => isPostingRef(j.ref, invoice.invoiceNumber))

  const matching = live.find(j => Math.abs(Number(j.totalDebit) - total) < 0.01)
  if (matching && live.length === 1) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { postingStatus: 'posted', postedJournalEntryId: matching.id } })
    return { ref: matching.ref, action: 'already' }
  }
  for (const stale of live) await reverseJournalEntry(stale.ref, actorId)

  const journal = await postInvoiceJournalToPrisma({
    id: invoice.id,
    ref: invoice.invoiceNumber,
    invoiceNumber: invoice.invoiceNumber,
    type: invoiceDocumentType(invoice),
    partnerName: invoice.client?.name ?? undefined,
    totalAmount: total,
    subtotal: Number(invoice.subtotal),
    taxAmount: Number(invoice.taxAmount),
    repairId: invoice.repairId ?? undefined,
    invoiceDate: invoice.invoiceDate,
    lines: invoice.items.map(i => ({
      productId: i.productId ?? undefined,
      qty: Number(i.qty),
      unitPrice: Number(i.unitPrice),
      subtotal: Number(i.lineSubtotal),
      description: i.description,
    })),
  }, { createdById: actorId })
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { postingStatus: 'posted', postedJournalEntryId: journal.id, postedAt: new Date(), ...(actorId ? { postedById: actorId } : {}) },
  })
  await recordInvoiceTax(invoiceId, journal.id).catch(err => console.error('[ensureInvoiceBooked] VAT record failed:', err))
  return { ref: journal.ref, action: live.length ? 'rebooked' : 'booked' }
}
