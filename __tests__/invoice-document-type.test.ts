import { describe, expect, it } from 'vitest'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'

describe('customer invoice or vendor bill', () => {
  it('keeps an invoice to a contact who is also a supplier as an invoice', () => {
    // The contact being a vendor says nothing about which way this document runs.
    expect(invoiceDocumentType({ documentType: 'customer_invoice', invoiceNumber: 'INV/2026/0412' })).toBe('customer_invoice')
  })

  it('trusts the stored document type for a bill', () => {
    expect(invoiceDocumentType({ documentType: 'vendor_bill', invoiceNumber: 'VB-77' })).toBe('vendor_bill')
  })

  it('recognises a bill saved before the document type existed by its number', () => {
    expect(invoiceDocumentType({ documentType: 'customer_invoice', invoiceNumber: 'BILL/2026/0031' })).toBe('vendor_bill')
  })

  it('treats a document raised against a purchase order as a bill', () => {
    expect(invoiceDocumentType({ invoiceNumber: 'X-1', purchaseOrderId: 'po-1' })).toBe('vendor_bill')
  })

  it('defaults to a customer invoice when nothing says otherwise', () => {
    expect(invoiceDocumentType({})).toBe('customer_invoice')
  })
})
