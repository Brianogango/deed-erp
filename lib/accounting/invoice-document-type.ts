/**
 * Whether a stored invoice row is a customer invoice or a vendor bill.
 *
 * Decided by the document, never by the contact. The broadcast that republishes
 * invoices to every browser used `client.isVendor`, so a contact who is both a
 * customer and a supplier had every invoice raised TO them shown under Bills —
 * and editing a contact to tick "vendor" re-broadcast the list and flipped all
 * of that customer's invoices at once. A receivable filed as a payable is not a
 * display problem: it moves the balance from AR to AP and a payment registered
 * against it posts as money paid out instead of money received.
 *
 * `documentType` is the record's own answer, but the column only arrived on
 * 22 Sep 2026 with a customer-invoice default, so a bill saved before then can
 * carry the default. Bills have always been numbered BILL… (DRAFT/BILL… as a
 * draft) — and a document
 * raised against a purchase order is a bill, so either of those also counts.
 */
type InvoiceDocumentType = 'customer_invoice' | 'vendor_bill'

export function invoiceDocumentType(row: {
  documentType?: string | null
  invoiceNumber?: string | null
  purchaseOrderId?: string | null
}): InvoiceDocumentType {
  if (String(row.documentType ?? '').toLowerCase() === 'vendor_bill') return 'vendor_bill'
  // BILL/2026/0031 once posted, DRAFT/BILL/2EBD3279 while still a draft.
  if (/^(DRAFT\/)?BILL\b/.test(String(row.invoiceNumber ?? '').trim().toUpperCase())) return 'vendor_bill'
  if (String(row.purchaseOrderId ?? '').trim()) return 'vendor_bill'
  return 'customer_invoice'
}
