import 'server-only'
import prisma from '@/lib/prisma'

/**
 * POS sales that never reached the general ledger.
 *
 * POS is the one sales path whose invoice row carries no usable posting signal.
 * /api/invoices POST deliberately skips its journal block for `isPosInvoice`,
 * because a till sale posts through /api/pos/post-sale-journal instead — Dr
 * cash or bank, Cr revenue, no AR. Nothing writes `postingStatus` back
 * afterwards, so every POS invoice reads `unposted` forever whether its journal
 * landed or not, and that column cannot distinguish success from failure.
 *
 * When the journal call does fail, the store logs an audit line, shows the
 * cashier a toast and moves on: no retry, no flag, no record anyone reads.
 * Three sales on 14 August 2026 — POS/0017, 0018 and 0019, KES 78,000 —
 * disappeared that way and were found six weeks later only because someone
 * went looking for something else.
 *
 * The journal ref is `JRN/<invoiceNumber>` (postPosSale builds it), so the
 * absence of that ref is the only reliable evidence. This looks for it.
 */

type PosJournalGap = {
  id: string
  invoiceNumber: string
  invoiceDate: Date
  totalAmount: number
  amountPaid: number
  status: string
  /** Whether a Payment row survives to say how it was tendered. */
  hasPaymentRecord: boolean
}

function posJournalRef(invoiceNumber: string): string {
  return `JRN/${invoiceNumber}`
}

/**
 * @param asOf optional upper bound on invoice date, for period-scoped checks.
 */
async function findPosSalesWithoutJournal(asOf?: Date): Promise<PosJournalGap[]> {
  const sales = await prisma.invoice.findMany({
    where: {
      isPosInvoice: true,
      status: { notIn: ['draft', 'cancelled', 'voided'] },
      ...(asOf ? { invoiceDate: { lte: asOf } } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      totalAmount: true,
      amountPaid: true,
      status: true,
    },
    orderBy: { invoiceDate: 'asc' },
  })
  if (sales.length === 0) return []

  // Match on ref rather than invoiceId: postPosSale passes invoiceId only when
  // the caller supplied it, so a journal can exist with a null link. The ref is
  // derived from the invoice number and is always present.
  const refs = sales.map(s => posJournalRef(s.invoiceNumber))
  const posted = await prisma.journalEntry.findMany({
    where: { ref: { in: refs } },
    select: { ref: true },
  })
  const have = new Set(posted.map(j => j.ref))

  const missing = sales.filter(s => !have.has(posJournalRef(s.invoiceNumber)))
  if (missing.length === 0) return []

  const payments = await prisma.payment.findMany({
    where: { invoiceId: { in: missing.map(m => m.id) }, isVoided: false },
    select: { invoiceId: true },
  })
  const paid = new Set(payments.map(p => p.invoiceId).filter(Boolean) as string[])

  return missing.map(s => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    invoiceDate: s.invoiceDate,
    totalAmount: Number(s.totalAmount),
    amountPaid: Number(s.amountPaid),
    status: String(s.status),
    // Without this the tender account cannot be known — which of cash, M-Pesa
    // or a bank account was debited is unrecoverable from the invoice alone,
    // and the gap has to be settled against a statement rather than guessed.
    hasPaymentRecord: paid.has(s.id),
  }))
}

export async function countPosSalesWithoutJournal(asOf?: Date): Promise<number> {
  return (await findPosSalesWithoutJournal(asOf)).length
}
