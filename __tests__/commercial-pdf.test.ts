import { describe, it, expect } from 'vitest'
import { buildCommercialPdf, type CommercialPdfInput } from '@/lib/commercial-pdf'

const company: any = {
  name: 'Deed Technologies LTD',
  address: 'Sanlam House, Kenyatta Avenue',
  city: 'Nairobi',
  phone: '0113407964',
  email: 'sales@deed.co.ke',
  kraPin: 'P051999898X',
  currency: 'KES',
  mpesaPaybill: '880100',
  mpesaAccount: '468778',
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
})
