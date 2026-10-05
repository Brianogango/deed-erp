/**
 * Laptops and other serial-tracked machines leave stock only when a delivery
 * is validated (the serials are picked there) or at the POS till. An invoice
 * raised any other way bills the machine while it stays in Ready for Sale —
 * the "invoiced but never delivered" gap. Customer invoices carrying a
 * serial-tracked product therefore need a sale order whose delivery has been
 * validated. POS tickets, repair bills, credit notes and opening balances are
 * outside this rule.
 */

export type SerialInvoiceDoc = {
  type?: unknown
  documentType?: unknown
  isCreditNote?: unknown
  isPosInvoice?: unknown
  isOpeningBalance?: unknown
  internalNotes?: unknown
  repairId?: unknown
  repairRef?: unknown
  notes?: unknown
  saleOrderId?: unknown
  purchaseOrderId?: unknown
}

export function serialInvoiceRuleApplies(doc: SerialInvoiceDoc): boolean {
  const type = String(doc.type ?? doc.documentType ?? 'customer_invoice')
  if (type === 'vendor_bill' || doc.purchaseOrderId) return false
  if (doc.isCreditNote === true || doc.isPosInvoice === true || doc.isOpeningBalance === true) return false
  if (String(doc.internalNotes ?? '').includes('[opening-balance]')) return false
  if (doc.repairId || doc.repairRef || /repair/i.test(String(doc.notes ?? ''))) return false
  return true
}

/** The refusal message, or null when the invoice may go ahead. */
export function serialInvoiceBlock(params: {
  doc: SerialInvoiceDoc
  serialProductNames: string[]
  deliveryValidated: boolean
}): string | null {
  if (!serialInvoiceRuleApplies(params.doc)) return null
  if (!params.serialProductNames.length) return null
  if (params.doc.saleOrderId && params.deliveryValidated) return null
  const names = [...new Set(params.serialProductNames)]
  const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` and ${names.length - 2} more` : '')
  return params.doc.saleOrderId
    ? `Validate the delivery on the sale order first, picking the serial numbers that go out (${shown}). Otherwise the machines stay in Ready for Sale after they are invoiced.`
    : `${shown} ${names.length === 1 ? 'is' : 'are'} serial-tracked: sell through a sale order and validate its delivery (or at the POS till), so the machines leave stock with their serial numbers.`
}
