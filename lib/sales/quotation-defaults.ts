/** Cash / due immediately unless a contact is given explicit credit terms. */
export const DEFAULT_CONTACT_PAYMENT_TERMS_DAYS = 0

export type QuotationPaymentTermsContact = {
  paymentTermsDays?: number | string | null
  paymentTerms?: string | null
}

/**
 * Quotations are due immediately unless the selected contact has explicit
 * credit terms. The legacy string is supported while older contacts migrate.
 */
export function quotationPaymentTermsDays(
  contact: QuotationPaymentTermsContact | null | undefined,
): number {
  const configuredTerms = contact?.paymentTermsDays
  if (configuredTerms !== null && configuredTerms !== undefined && configuredTerms !== '') {
    const configuredDays = Number(configuredTerms)
    if (Number.isFinite(configuredDays) && configuredDays >= 0) {
      return Math.trunc(configuredDays)
    }
  }

  const legacyTerms = contact?.paymentTerms?.trim()
  if (!legacyTerms || /^immediate$/i.test(legacyTerms)) return 0

  const legacyDays = Number.parseInt(legacyTerms.match(/\d+/)?.[0] ?? '', 10)
  return Number.isFinite(legacyDays) && legacyDays >= 0 ? legacyDays : DEFAULT_CONTACT_PAYMENT_TERMS_DAYS
}

export function quotationPaymentTermsLabel(days: number): string {
  return days > 0 ? `Net ${days}` : 'Immediate'
}

export function serializeQuotationPaymentTerms(days: number): string {
  return days > 0 ? `${days} days` : 'Immediate'
}
