import 'server-only'
import prisma from '@/lib/prisma'
import { enqueueDurableJob } from '@/lib/infra/jobs'

/**
 * Durable retry for an invoice's GL posting (KI-02).
 *
 * Confirming an invoice commits in a Serializable transaction; the journal and
 * tax rows are written *after* that commit, deliberately, so a misconfigured
 * Chart of Accounts or a locked fiscal period cannot stop someone confirming a
 * customer document. That tradeoff is kept — the alternative blocks the
 * business on an accounting misconfiguration.
 *
 * What was missing is what happened next. On failure the invoice was left at
 * `postingStatus='unposted'`, the error logged, and the only thing that
 * noticed was the integrity suite, which reports a count for a human to read.
 * So a transient failure — a deadlock, a period briefly locked, a concurrent
 * Chart of Accounts edit — needed manual intervention to clear, and an invoice
 * could sit posted-but-unjournalled indefinitely.
 *
 * The posting is now retried with backoff. A permanent failure still exhausts
 * its attempts and stays visible as `unposted` to the integrity suite, so
 * nothing is swept under the rug; a transient one heals itself.
 *
 * Retrying is safe because both halves are idempotent:
 *  - `allocateInvoiceJournalRef` returns the *canonical* `JRN/<number>` ref
 *    unless that entry exists and is reversed, so a retry asks for the same
 *    ref the first attempt used;
 *  - `createJournalEntry` looks that ref up and returns the existing entry
 *    rather than posting a second one;
 *  - `recordInvoiceTax` upserts on (sourceType, sourceId, sourceLineId).
 * A retry that runs after the journal was created but before the invoice row
 * was updated therefore links the existing journal instead of duplicating it,
 * which is exactly the orphaned state KI-02 describes.
 */
export const INVOICE_POSTING_JOB = 'retry_invoice_posting'

export async function enqueueInvoicePostingRetry(invoiceId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  try {
    await enqueueDurableJob({
      type: INVOICE_POSTING_JOB,
      queue: 'accounting',
      // One pending retry per invoice, however many times confirm is pressed.
      uniqueKey: `${INVOICE_POSTING_JOB}:${invoiceId}`,
      payload: { invoiceId, lastError: message.slice(0, 500) },
      maxAttempts: 5,
    })
  } catch (enqueueErr) {
    console.error(`[invoice-posting] could not queue retry for ${invoiceId}:`, enqueueErr)
  }
}

export type InvoicePostingRetryResult = {
  invoiceId: string
  outcome: 'posted' | 'already_posted' | 'not_postable'
  journalId?: string
}

/** Statuses that represent a confirmed document, i.e. one that should have a journal. */
const POSTABLE_STATUSES = new Set(['approved', 'invoiced', 'dispatched', 'delivered'])

/**
 * Re-attempt the GL posting for one invoice. Reads the invoice's current state
 * rather than trusting the payload: if it has since been posted, cancelled or
 * reverted to draft, that wins and this is a no-op.
 */
export async function runInvoicePostingRetry(payload: unknown): Promise<InvoicePostingRetryResult> {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const invoiceId = String(record.invoiceId || '')
  if (!invoiceId) throw new Error('retry_invoice_posting job has no invoiceId')

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  })
  if (!invoice) return { invoiceId, outcome: 'not_postable' }
  if (invoice.postingStatus === 'posted' && invoice.postedJournalEntryId) {
    return { invoiceId, outcome: 'already_posted', journalId: invoice.postedJournalEntryId }
  }
  // A draft or cancelled invoice that failed to post and was then reverted
  // must not be resurrected by a retry.
  if (!POSTABLE_STATUSES.has(String(invoice.status))) {
    return { invoiceId, outcome: 'not_postable' }
  }

  const [{ buildInvoiceJournalInput, allocateInvoiceJournalRef }, { createJournalEntry }, { recordInvoiceTax }, { resolveBlobInvoiceMirror }] =
    await Promise.all([
      import('@/lib/accounting/invoice-journals'),
      import('@/lib/accounting/journal-service'),
      import('@/lib/accounting/invoice-tax.server'),
      import('@/lib/accounting/resolve-invoice-mirror'),
    ])

  const mirror = await resolveBlobInvoiceMirror(invoice.id)
  const documentType = invoice.documentType === 'vendor_bill' || mirror.type === 'vendor_bill'
    ? 'vendor_bill'
    : 'customer_invoice'

  const journalInput = await buildInvoiceJournalInput({
    id: invoice.id,
    ref: String(invoice.invoiceNumber),
    invoiceNumber: String(invoice.invoiceNumber),
    invoiceDate: invoice.invoiceDate,
    totalAmount: Number(invoice.totalAmount),
    subtotal: Number(invoice.subtotal),
    taxAmount: Number(invoice.taxAmount),
    type: documentType,
    repairId: invoice.repairId ?? undefined,
    purchaseOrderId: mirror.purchaseOrderId ?? undefined,
    partnerName: mirror.partnerName,
    clientName: mirror.clientName,
    lines: invoice.items.map(item => ({
      productId: item.productId ?? undefined,
      qty: Number(item.qty),
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.lineSubtotal),
      description: item.description,
    })),
  }, { createdById: invoice.postedById ?? undefined })

  journalInput.ref = await allocateInvoiceJournalRef(journalInput.ref)

  // Throwing from here marks the job for another attempt with backoff.
  const journal = await createJournalEntry(journalInput)
  await recordInvoiceTax(invoice.id, journal.id)
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      postingStatus: 'posted',
      postedJournalEntryId: journal.id,
      postedAt: invoice.postedAt ?? new Date(),
      documentType,
    },
  })
  return { invoiceId, outcome: 'posted', journalId: journal.id }
}
