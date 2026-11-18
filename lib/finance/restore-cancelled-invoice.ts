/**
 * Bringing a cancelled invoice or bill back.
 *
 * A cancelled document comes back as a DRAFT, never straight to posted.
 * Cancelling reversed its posting journal (or, on a paid invoice, raised a
 * credit note), so a document that reappeared as posted would sit in the
 * books with its own reversal still standing and the ledger would be wrong
 * by its value. As a draft it is out of the books entirely; confirming it
 * again posts a fresh journal, and the original posting, its reversal and
 * the new posting net out correctly.
 *
 * Pure — the caller supplies the document, the credit notes raised from it,
 * and who is asking.
 */

export interface RestorableInvoice {
  id: string
  ref: string
  type?: string | null
  status?: string | null
  amountPaid?: number | null
  total?: number | null
}

export interface InvoiceCredit {
  id: string
  ref: string
  sourceInvoiceId?: string | null
  amount?: number | null
  balance?: number | null
  status?: string | null
  applications?: unknown[] | null
}

export type RestoreDecision =
  | { ok: true; nextStatus: 'draft'; creditToVoid: InvoiceCredit | null }
  | { ok: false; error: string }

const money = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** A credit note that has been spent cannot be taken back. */
export function creditIsSpent(credit: InvoiceCredit): boolean {
  if (Array.isArray(credit.applications) && credit.applications.length > 0) return true
  const status = String(credit.status ?? '')
  if (status === 'used' || status === 'partially_used') return true
  return money(credit.balance) < money(credit.amount)
}

export function restoreCancelledInvoiceDecision(args: {
  invoice: RestorableInvoice
  credits?: InvoiceCredit[]
  /** canCancelOrResetInvoice(role) — the same right as cancelling one. */
  allowed: boolean
}): RestoreDecision {
  const { invoice } = args
  const noun = invoice.type === 'vendor_bill' ? 'bill' : 'invoice'

  if (!args.allowed) {
    return { ok: false, error: `Only Finance, Admin Officer, or Director can restore a cancelled ${noun}` }
  }
  if (String(invoice.status ?? '') !== 'cancelled') {
    return { ok: false, error: `This ${noun} is not cancelled` }
  }

  const credits = (args.credits ?? []).filter(c => c.sourceInvoiceId === invoice.id && String(c.status ?? '') !== 'void')
  const spent = credits.find(creditIsSpent)
  if (spent) {
    return {
      ok: false,
      error: `Credit note ${spent.ref} from this ${noun} has already been used. Reverse or refund it first — restoring now would count the money twice.`,
    }
  }

  // A payment recorded against the cancelled document has nowhere to sit on a
  // draft, and the money needs deciding on its own terms (refund, or credit
  // left standing) rather than being carried back in silence.
  if (money(invoice.amountPaid) > 0 && credits.length === 0) {
    return {
      ok: false,
      error: `This ${noun} was paid ${money(invoice.amountPaid).toLocaleString('en-KE')}. Refund or re-allocate the payment first; a draft cannot hold it.`,
    }
  }

  return { ok: true, nextStatus: 'draft', creditToVoid: credits[0] ?? null }
}

/** What the person is told once it is back. */
export function restoreSummary(invoice: RestorableInvoice, creditVoided: InvoiceCredit | null): string {
  const noun = invoice.type === 'vendor_bill' ? 'Bill' : 'Invoice'
  return creditVoided
    ? `${noun} ${invoice.ref} is a draft again — credit note ${creditVoided.ref} was voided with it. Check it, then confirm to post it.`
    : `${noun} ${invoice.ref} is a draft again. Check it, then confirm to post it.`
}

/**
 * The server's gate for a document leaving `cancelled`.
 *
 * Without it, any PUT carrying `draft` would un-cancel one — and `draft` is
 * exactly what a stale tab holds, so an ordinary edit from a browser that
 * never saw the cancellation would quietly bring it back. The same reasoning
 * as the reset-to-draft gate: the intent must be stated, not inferred.
 */
export function restoreFromCancelledGuard(args: {
  beforeStatus: string
  nextStatus?: string
  restoreRequested?: boolean
  allowed: boolean
}): { ok: true } | { ok: false; status: number; error: string } {
  const leaving = ['cancelled', 'voided'].includes(String(args.beforeStatus))
  const next = String(args.nextStatus ?? '')
  if (!leaving || !next || ['cancelled', 'voided'].includes(next)) return { ok: true }

  if (args.restoreRequested !== true) {
    return { ok: false, status: 409, error: 'A cancelled document is restored deliberately, not by an ordinary edit' }
  }
  if (!args.allowed) {
    return { ok: false, status: 403, error: 'Only Finance, Admin Officer, or Director can restore a cancelled document' }
  }
  if (next !== 'draft') {
    return { ok: false, status: 409, error: 'A cancelled document comes back as a draft, and is confirmed again from there' }
  }
  return { ok: true }
}
