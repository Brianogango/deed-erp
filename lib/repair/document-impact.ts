/**
 * What a repair's price change means for the documents already raised from it.
 *
 * A repair can be walked back a stage and re-quoted at any time, and it should
 * stay that way — going back is usually about something technical, not money.
 * The hazard is the case where it IS about money: the quote is revised, and the
 * sale order and invoice already raised from the old figures silently stop
 * agreeing with it. Nothing said anything, so a posted invoice could drift from
 * the job it bills and only surface weeks later in the ledger.
 *
 * This answers the question at the moment of the change: what has to follow,
 * for each document, and which of those the system can do by itself.
 *
 * Pure, so the rules are testable without a repair, a store, or a database.
 */

export type RepairDocAction =
  /** The document is still editable and will be brought into line. */
  | 'updates_automatically'
  /** Confirmed, so the change needs a new version rather than an edit. */
  | 'needs_new_version'
  /** Posted and the price went DOWN — the customer is over-billed. */
  | 'needs_credit_note'
  /** Posted and the price went UP — the difference is not yet billed. */
  | 'needs_debit_note'

export type RepairDocImpact = {
  doc: 'sale_order' | 'invoice'
  ref: string
  action: RepairDocAction
  detail: string
}

export type RepairPriceChangeImpact = {
  changed: boolean
  previousTotal: number
  nextTotal: number
  /** next − previous. Positive means the job got more expensive. */
  difference: number
  impacts: RepairDocImpact[]
  /** True when something needs a person: a new version, or a note to raise. */
  needsAttention: boolean
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

const fmt = (n: number) => `KES ${Math.abs(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`

/** Sale-order states that are still a quotation and can simply be rewritten. */
const EDITABLE_SALE_ORDER_STATUSES = new Set(['quotation', 'quotation_sent', 'draft', 'sent'])

/** The only invoice state whose lines may still be changed in place. */
const EDITABLE_INVOICE_STATUSES = new Set(['draft'])

/** States where a document no longer exists for this purpose. */
const DEAD_STATUSES = new Set(['cancelled', 'voided'])

export function repairPriceChangeImpact(opts: {
  previousTotal: unknown
  nextTotal: unknown
  saleOrder?: { ref?: string | null; status?: string | null } | null
  invoice?: { ref?: string | null; status?: string | null } | null
}): RepairPriceChangeImpact {
  const previousTotal = money(opts.previousTotal)
  const nextTotal = money(opts.nextTotal)
  const difference = money(nextTotal - previousTotal)
  // Sub-shilling drift is rounding, not a re-price.
  const changed = Math.abs(difference) >= 1

  if (!changed) {
    return { changed: false, previousTotal, nextTotal, difference: 0, impacts: [], needsAttention: false }
  }

  const impacts: RepairDocImpact[] = []
  const direction = difference > 0 ? 'up' : 'down'

  const soStatus = String(opts.saleOrder?.status ?? '').toLowerCase()
  if (opts.saleOrder && soStatus && !DEAD_STATUSES.has(soStatus)) {
    const ref = opts.saleOrder.ref || 'the sale order'
    impacts.push(EDITABLE_SALE_ORDER_STATUSES.has(soStatus)
      ? {
        doc: 'sale_order',
        ref,
        action: 'updates_automatically',
        detail: `${ref} is still a quotation and will be updated to ${fmt(nextTotal)}.`,
      }
      : {
        doc: 'sale_order',
        ref,
        action: 'needs_new_version',
        detail: `${ref} is confirmed. Raise a new version to carry the ${fmt(difference)} ${direction === 'up' ? 'increase' : 'reduction'}.`,
      })
  }

  const invStatus = String(opts.invoice?.status ?? '').toLowerCase()
  if (opts.invoice && invStatus && !DEAD_STATUSES.has(invStatus)) {
    const ref = opts.invoice.ref || 'the invoice'
    if (EDITABLE_INVOICE_STATUSES.has(invStatus)) {
      impacts.push({
        doc: 'invoice',
        ref,
        action: 'updates_automatically',
        detail: `${ref} is still a draft and will be aligned to ${fmt(nextTotal)}.`,
      })
    } else if (direction === 'up') {
      impacts.push({
        doc: 'invoice',
        ref,
        action: 'needs_debit_note',
        detail: `${ref} is posted and bills ${fmt(difference)} less than the revised quote. Raise a debit note for the difference.`,
      })
    } else {
      impacts.push({
        doc: 'invoice',
        ref,
        action: 'needs_credit_note',
        detail: `${ref} is posted and over-bills the customer by ${fmt(difference)}. Raise a credit note for the difference.`,
      })
    }
  }

  const needsAttention = impacts.some(i => i.action !== 'updates_automatically')
  return { changed, previousTotal, nextTotal, difference, impacts, needsAttention }
}

/** One line per document, for a toast or a confirmation panel. */
export function describeRepairPriceChange(impact: RepairPriceChangeImpact): string {
  if (!impact.changed || impact.impacts.length === 0) return ''
  const heading = impact.difference > 0
    ? `Quote increased by ${fmt(impact.difference)}.`
    : `Quote reduced by ${fmt(impact.difference)}.`
  return [heading, ...impact.impacts.map(i => `• ${i.detail}`)].join('\n')
}
