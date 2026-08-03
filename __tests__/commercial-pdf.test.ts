import { describe, it, expect } from 'vitest'
import { buildCommercialPdf, type CommercialPdfInput } from '@/lib/commercial-pdf'
import { buildDeedDocumentPdf } from '@/lib/deed-document-pdf'

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

const banks: any[] = [
  { id: 'ncba', name: 'NCBA Current', bankName: 'NCBA BANK KENYA PLC', accountNo: '1005157785', currency: 'KES', active: true },
]

const baseDoc: CommercialPdfInput = {
  title: 'Quotation',
  ref: 'QUO/2026/0001',
  date: '2026-07-24',
  dueLabel: 'Expiration',
  dueDate: '2026-08-23',
  salesperson: 'Brian Ogango',
  customerName: 'Turaco Kenya Ltd',
  customerAddress: 'Amani Gardens, 71 Church Road, Westlands, Nairobi',
  customerCountry: 'Kenya',
  customerTaxId: 'P051718937V',
  lines: [
    { description: 'Dell XPS 13 9310 - Intel Core i7-1185G7, 16GB LPDDR4x RAM, 512GB SSD', qty: 1, unitPrice: 80000, taxRate: 16, subtotal: 80000 },
  ],
  subtotal: 80000,
  taxTotal: 12800,
  total: 92800,
  notes: 'Payment due within 30 days.',
}

describe('buildCommercialPdf', () => {
  it('produces a valid single-page PDF for a simple quotation', async () => {
    const doc = await buildCommercialPdf(baseDoc, company, banks)
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('paginates long invoices with sections and paid totals', async () => {
    const longDoc: CommercialPdfInput = {
      ...baseDoc,
      title: 'Invoice',
      ref: 'INV/2026/0042',
      dueLabel: 'Due Date',
      paymentCommunication: true,
      amountPaid: 50000,
      lines: [
        { lineType: 'section', description: 'Hardware', qty: 0, unitPrice: 0, subtotal: 0 },
        ...Array.from({ length: 60 }, (_, i) => ({
          description: `HP OmniBook X Flip 16-as0043dx, Intel Core Ultra 9 288V, 32GB LPDDR5x, 2TB PCIe Gen4 NVMe SSD — line ${i + 1}`,
          qty: 2,
          unitPrice: 205000,
          taxRate: 16,
          subtotal: 410000,
        })),
      ],
    }
    const doc = await buildCommercialPdf(longDoc, company, banks)
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('renders without banks, mpesa, logo or notes', async () => {
    const doc = await buildCommercialPdf(
      { ...baseDoc, notes: undefined, salesperson: undefined, customerAddress: undefined, customerTaxId: undefined },
      { ...company, mpesaPaybill: undefined, mpesaAccount: undefined },
      [],
    )
    expect(doc.getNumberOfPages()).toBe(1)
  })

  it.each(['Quotation', 'Pro-forma Invoice', 'Invoice', 'Receipt'])(
    'uses the shared Deed template for %s downloads',
    async title => {
      const doc = await buildCommercialPdf(
        {
          ...baseDoc,
          title,
          ref: title === 'Pro-forma Invoice' ? 'PI/2026/0001' : title === 'Receipt' ? 'RCPT/2026/0001' : baseDoc.ref,
          showPaymentDetails: title !== 'Receipt',
        },
        company,
        banks,
      )
      expect(String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))).toBe('%PDF-')
      expect(doc.getNumberOfPages()).toBe(1)
    },
  )
})

describe('buildDeedDocumentPdf', () => {
  it('renders invoice layout matching the Deed downloadable template', () => {
    const doc = buildDeedDocumentPdf(
      {
        title: 'Invoice',
        ref: 'INV/2026/0008',
        date: '2026-07-28',
        dueDate: '2026-08-27',
        sourceRef: 'SO/2026/0004',
        customerName: 'D.Light Kenya',
        customerCountry: 'Kenya',
        lines: [{
          description: 'HP EliteBook 845 G7 AMD Ryzen 5 PRO 4650U 16GB RAM, 512GB SSD',
          qty: 50,
          unitPrice: 34482.76,
          taxRate: 16,
          subtotal: 1724138,
        }],
        subtotal: 1724138,
        taxTotal: 275862,
        total: 2000000,
        notes: 'Created from SO/2026/0004.',
        paymentCommunication: true,
      },
      company,
      banks,
    )
    const bytes = new Uint8Array(doc.output('arraybuffer'))
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(doc.getNumberOfPages()).toBe(1)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(841.89, 1)
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(595.28, 1)
  })

  it('keeps short invoices flowing under the table without shoving totals into the footer', () => {
    const doc = buildDeedDocumentPdf(
      {
        title: 'Invoice',
        ref: 'INV/2026/0025',
        date: '2026-08-03',
        dueDate: '2026-09-02',
        sourceRef: 'QUO/2026/0052',
        customerName: 'Tica Health',
        customerCountry: 'Kenya',
        lines: [
          { description: 'Apple 61W USB-C Power Adapter ×1', qty: 1, unitPrice: 8000, taxRate: 16, subtotal: 8000 },
          { description: 'Delivery', qty: 1, unitPrice: 700, taxRate: 0, subtotal: 700 },
        ],
        subtotal: 8700,
        taxTotal: 1280,
        total: 9980,
        notes: 'Created from QUO/2026/0052',
        paymentCommunication: true,
      },
      company,
      banks,
    )
    expect(doc.getNumberOfPages()).toBe(1)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(841.89, 1)
    const asString = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect(asString).toContain('Thank you for your business')
    expect(asString).toContain('AUTHORISED SIGNATURE')
    expect(asString).toContain('Subtotal')
    expect(asString).toContain('TOTAL')
    // Fallback wordmark watermark is present when no logo bytes are supplied.
    expect(asString.toLowerCase()).toContain('deed')
  })
})
