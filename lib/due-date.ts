/**
 * Due dates from a contact's credit period.
 *
 * A contact's `paymentTermsDays` is the credit period set on the contact form.
 * Several places ignored it: the manual invoice/bill form left Due Date blank,
 * and some automatic invoices/bills used a fixed 14/30 days.
 */

/** The contact's credit period in days, or `fallback` when none is set. */
export function contactPaymentTermsDays(
  contact: { paymentTermsDays?: number | string | null } | null | undefined,
  fallback: number,
): number {
  const raw = contact?.paymentTermsDays
  if (raw === null || raw === undefined || raw === '') return fallback
  const days = Number(raw)
  return Number.isFinite(days) && days >= 0 ? Math.trunc(days) : fallback
}

/**
 * `YYYY-MM-DD` + `termsDays`, as `YYYY-MM-DD` (what `<input type="date">`
 * holds). Empty string when the date is missing or invalid. Calendar-date
 * arithmetic in UTC, so the result never shifts with the viewer's timezone.
 */
export function dueDateFromTerms(documentDate: string, termsDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(documentDate ?? '').trim())
  if (!match) return ''
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (!Number.isFinite(base) || !Number.isFinite(termsDays)) return ''
  return new Date(base + Math.trunc(termsDays) * 86400000).toISOString().slice(0, 10)
}

/**
 * Days a customer has to pay an invoice: none for a corporate customer
 * without approved credit (payment policy: payment on receipt), otherwise
 * the contact's credit period. Vendor bills use contactPaymentTermsDays.
 */
export function customerPaymentTermsDays(
  contact: { paymentTermsDays?: number | string | null; type?: string | null; creditStatus?: string | null } | null | undefined,
  fallback: number,
  /** System setting accCreditPayOnReceiptEnforced. */
  enforced?: boolean | null,
): number {
  if (enforced && contact?.type === 'company' && contact.creditStatus && ['none', 'suspended', 'revoked'].includes(contact.creditStatus)) return 0
  return contactPaymentTermsDays(contact, fallback)
}
