/**
 * Re-quoting a repair whose invoice is already posted.
 *
 * A posted invoice is in the ledger and has gone to the client (and possibly
 * to KRA), so it is never edited. The rule the shop agreed:
 *
 *   1. The technician revises the quote. Nothing billed changes yet — the
 *      revision is only a proposal until the client approves it
 *      (`awaiting_client`). If they decline, the original invoice stands
 *      (`dropped`).
 *   2. The client approves. Finance is asked to reissue (`pending`); the
 *      repair cannot be released until they have.
 *   3. Finance reissues in one step (`credited`): the old invoice is credited
 *      in full, anything paid on it becomes the client's credit, the sale
 *      order carries the approved quote, and the repair is freed to be billed
 *      afresh — the new invoice is raised the usual way and the credit applied
 *      to it.
 *
 * A draft invoice, or one that never reached the ledger, is simply updated in
 * place — there is nothing to reverse.
 *
 * Pure, so the rules can be tested on their own.
 */

export type InvoiceReissueStatus = 'awaiting_client' | 'pending' | 'credited' | 'dropped'

export type InvoiceReissue = {
  status: InvoiceReissueStatus
  invoiceId: string
  invoiceRef: string
  previousTotal: number
  revisedTotal: number
  raisedAt: string
  approvedAt?: string
  droppedAt?: string
  creditNoteRef?: string
  creditedAt?: string
  creditedBy?: string
  /** What the client had paid on the old invoice, now held as their credit. */
  customerCredit?: number
}

export const INVOICE_REISSUE_ROLES = ['director', 'finance_officer']

/** Store-side invoice states that can still be rewritten in place. */
export function isInvoiceEditableInPlace(status: unknown): boolean {
  return status === 'draft'
}

/** The ledger's word, not the store's: posted means a journal exists. */
export function invoiceReachedLedger(invoice: { postingStatus?: string | null; postedJournalEntryId?: string | null } | null | undefined): boolean {
  if (!invoice) return false
  return invoice.postingStatus === 'posted' || Boolean(invoice.postedJournalEntryId)
}

/**
 * On a quote revision: whether the invoice must wait for a reissue.
 * Returns null when there is no live invoice, or it is still a draft.
 */
export function reissueOnRevision(input: {
  invoice: { id: string; ref?: string | null; status?: string | null } | null | undefined
  previousTotal: number
  revisedTotal: number
  now: string
  existing?: InvoiceReissue | null
}): InvoiceReissue | null {
  const { invoice } = input
  if (!invoice?.id) return null
  const status = String(invoice.status ?? '')
  if (isInvoiceEditableInPlace(status) || status === 'cancelled' || status === 'voided') return null
  const open = input.existing && (input.existing.status === 'awaiting_client' || input.existing.status === 'pending')
    && input.existing.invoiceId === invoice.id
  return {
    status: 'awaiting_client',
    invoiceId: invoice.id,
    invoiceRef: String(invoice.ref ?? input.existing?.invoiceRef ?? ''),
    // A second revision before the first is settled keeps the original figure.
    previousTotal: open ? input.existing!.previousTotal : input.previousTotal,
    revisedTotal: input.revisedTotal,
    raisedAt: open ? input.existing!.raisedAt : input.now,
  }
}

export function reissueAfterClientDecision(reissue: InvoiceReissue | null | undefined, approved: boolean, now: string): InvoiceReissue | null {
  if (!reissue || reissue.status !== 'awaiting_client') return reissue ?? null
  return approved
    ? { ...reissue, status: 'pending', approvedAt: now }
    : { ...reissue, status: 'dropped', droppedAt: now }
}

/** Why the repair may not be billed again or released yet, or null. */
export function reissueBlocker(reissue: InvoiceReissue | null | undefined): string | null {
  if (!reissue) return null
  if (reissue.status === 'awaiting_client') {
    return `The revised quote is waiting for the client. ${reissue.invoiceRef || 'The invoice'} stays as it is until they approve.`
  }
  if (reissue.status === 'pending') {
    return `Finance must credit ${reissue.invoiceRef || 'the old invoice'} and reissue it from the approved quote before this repair is billed or released.`
  }
  return null
}

/**
 * Lines crediting whatever of each invoice line has not been credited yet —
 * a full credit, safe to repeat after a partial one.
 */
export function fullCreditLines(
  items: Array<{ id: string; qty: unknown }>,
  creditedQtyByItem: Record<string, number>,
): Array<{ invoiceItemId: string; qty: number }> {
  return items
    .map(item => ({ invoiceItemId: item.id, qty: Math.round((Number(item.qty) - (creditedQtyByItem[item.id] ?? 0)) * 1e6) / 1e6 }))
    .filter(line => line.qty > 0)
}

export function reissueCredited(reissue: InvoiceReissue, credit: { ref: string; customerCredit: number }, actorName: string, now: string): InvoiceReissue {
  return {
    ...reissue,
    status: 'credited',
    creditNoteRef: credit.ref,
    creditedAt: now,
    creditedBy: actorName,
    customerCredit: credit.customerCredit,
  }
}

type QuoteLineForOrder = {
  type?: string
  productId?: string | null
  description?: string
  productName?: string
  qty?: unknown
  unitPrice?: unknown
  subtotal?: unknown
  decision?: string
}

/**
 * The sale-order lines the reissue carries: the approved quote lines only
 * (declined and deferred ones stay off the bill), with the quote's VAT rate.
 * lineTotal is net of VAT, as the sale-order table stores it.
 */
export function approvedQuoteOrderItems(
  quote: { lines?: QuoteLineForOrder[]; subtotal?: unknown; tax?: unknown } | null | undefined,
  isProductId: (id: string) => boolean,
) {
  const subtotal = Number(quote?.subtotal) || 0
  const tax = Number(quote?.tax) || 0
  const taxRate = subtotal > 0 && tax > 0 ? Math.round((tax / subtotal) * 100) : 0
  return (quote?.lines ?? [])
    .filter(line => !line.decision || line.decision === 'approved')
    .map((line, index) => {
      const qty = Math.max(1, Math.round(Number(line.qty) || 1))
      const unitPrice = Math.round((Number(line.unitPrice) || 0) * 100) / 100
      const productId = String(line.productId ?? '').trim()
      return {
        description: String(line.description || line.productName || 'Repair service'),
        qty,
        unitPrice,
        taxRate,
        discountPct: 0,
        lineTotal: Math.round(qty * unitPrice),
        sortOrder: index,
        ...(productId && isProductId(productId) ? { productId } : {}),
      }
    })
}
