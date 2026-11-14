/**
 * Tax a customer withholds from what they pay us (client-safe).
 *
 * A withholding agent pays part of the invoice to KRA instead of to us and
 * hands over a certificate. That part settles the invoice like a payment, but
 * no money reaches a bank: it is a tax credit.
 *   - Withholding VAT (2% of the amount before VAT): deducted from the VAT we
 *     owe in the return. Dr 1151 VAT Withheld by Customers / Cr AR.
 *   - Withholding income tax: credited against our income tax.
 *     Dr 1152 Withholding Tax Credits / Cr AR.
 * It is recorded as a payment with one of the methods below; the certificate
 * number is its reference.
 */
export const WITHHELD_VAT = 'withheld_vat'
export const WITHHELD_INCOME_TAX = 'withheld_income_tax'

export type WithholdingMethod = typeof WITHHELD_VAT | typeof WITHHELD_INCOME_TAX

export const WITHHOLDING_KINDS: Record<WithholdingMethod, { label: string; accountCode: string; accountLabel: string; defaultRatePct: number }> = {
  [WITHHELD_VAT]: { label: 'Withholding VAT', accountCode: '1151', accountLabel: '1151 - VAT Withheld by Customers', defaultRatePct: 2 },
  [WITHHELD_INCOME_TAX]: { label: 'Withholding income tax', accountCode: '1152', accountLabel: '1152 - Withholding Tax Credits', defaultRatePct: 5 },
}

export const isWithholdingMethod = (method: unknown): method is WithholdingMethod =>
  method === WITHHELD_VAT || method === WITHHELD_INCOME_TAX

/** What the customer would withhold at the usual rate: a % of the invoice before VAT, never more than the balance. */
export function suggestedWithholding(kind: WithholdingMethod, invoice: { total: number; tax?: number; subtotal?: number; amountPaid?: number }): number {
  const total = Number(invoice.total) || 0
  const beforeVat = Number.isFinite(Number(invoice.subtotal)) && Number(invoice.subtotal) > 0
    ? Number(invoice.subtotal)
    : total - (Number(invoice.tax) || 0)
  const amount = Math.round(beforeVat * WITHHOLDING_KINDS[kind].defaultRatePct) / 100
  const balance = Math.max(0, total - (Number(invoice.amountPaid) || 0))
  return Math.min(amount, balance)
}
