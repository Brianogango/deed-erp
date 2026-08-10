import { describe, it, expect } from 'vitest'
import { buildCommercialPdf } from '@/lib/commercial-pdf'
import { purchaseOrderPdfInput, purchasePdfKind } from '@/lib/purchase-pdf'
import type { PurchaseOrder } from '@/lib/store'

const company: any = {
  name: 'Deed Technologies LTD',
  address: 'Sanlam House, Kenyatta Avenue',
  city: 'Nairobi 6690-20200',
  phone: '0113407964',
  email: 'info@deed.africa',
  website: 'http://deed.africa',
  kraPin: 'P051999898X',
  currency: 'KES',
  mpesaPaybill: '880100',
  mpesaAccount: '468778',
  invoiceFooter: 'Thank you for your business.',
}

const rfq: PurchaseOrder = {
  id: 'po-1',
  ref: 'PO/2026/0012',
  status: 'sent',
  vendorId: 'v1',
  vendorName: 'TechSource Kenya Ltd',
  date: '2026-08-10',
  expectedDate: '2026-08-20',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      productName: 'Lenovo ThinkPad T14',
      qty: 2,
      qtyReceived: 0,
      unitPrice: 85000,
      taxRate: 16,
      subtotal: 170000,
      requiresSerial: true,
      specs: 'i7 / 16GB / 512GB',
    },
  ],
  subtotal: 170000,
  taxTotal: 27200,
  total: 197200,
  notes: 'Urgent for client project',
  receiptIds: [],
}

describe('purchase RFQ/PO PDF', () => {
  it('maps draft/sent as RFQ and confirmed+ as PO', () => {
    expect(purchasePdfKind({ status: 'draft' })).toBe('rfq')
    expect(purchasePdfKind({ status: 'sent' })).toBe('rfq')
    expect(purchasePdfKind({ status: 'confirmed' })).toBe('po')
    expect(purchasePdfKind({ status: 'received' })).toBe('po')
  })

  it('builds invoice-style RFQ PDF without payment details', async () => {
    const input = purchaseOrderPdfInput(rfq, [
      {
        id: 'v1',
        name: 'TechSource Kenya Ltd',
        type: 'company',
        isCustomer: false,
        isVendor: true,
        address: 'Industrial Area',
        city: 'Nairobi',
        country: 'Kenya',
      } as any,
    ], 'rfq')
    expect(input.title).toBe('Request for Quotation')
    expect(input.partyLabel).toBe('Vendor')
    expect(input.showPaymentDetails).toBe(false)
    expect(input.dueLabel).toBe('Expected')
    expect(input.lines[0]?.description).toContain('Lenovo ThinkPad T14')

    const doc = await buildCommercialPdf(input, company, [])
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('builds invoice-style Purchase Order PDF', async () => {
    const po = { ...rfq, status: 'confirmed' as const }
    const input = purchaseOrderPdfInput(po, [], 'po')
    expect(input.title).toBe('Purchase Order')
    const doc = await buildCommercialPdf(input, company, [])
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })
})
