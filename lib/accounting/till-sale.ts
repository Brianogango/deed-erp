/**
 * A till (POS) sale's invoice: flagged as POS, or — older ones from before the
 * flag — numbered POS/… with no sale order behind it. An invoice raised from a
 * sale order is never a till sale, whatever its number says.
 */
export const isPosNumber = (invoiceNumber: unknown) => /^POS\//.test(String(invoiceNumber ?? ''))

export function isTillSale(doc: { invoiceNumber?: string | null; isPosInvoice?: boolean | null; saleOrderId?: string | null }): boolean {
  return doc.isPosInvoice === true || (isPosNumber(doc.invoiceNumber) && !doc.saleOrderId)
}
