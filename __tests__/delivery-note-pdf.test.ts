import { describe, it, expect } from 'vitest'
import {
  buildDeliveryNoteLines,
  buildDeliveryNotePdfInput,
  resolveDeliveryUnitSpecs,
} from '@/lib/delivery-note-pdf'
import { buildDeedDocumentPdf } from '@/lib/deed-document-pdf'
import type { Delivery, SerialNumber } from '@/lib/store'

const company: any = {
  name: 'Deed Technologies LTD',
  address: 'Sanlam House, Kenyatta Avenue',
  city: 'Nairobi',
  phone: '0113407964',
  email: 'info@deed.africa',
  website: 'http://deed.africa',
  kraPin: 'P051999898X',
  currency: 'KES',
  invoiceFooter: 'Thank you for your business.',
}

const delivery: Delivery = {
  id: 'del-1',
  ref: 'DN-2026-0001',
  saleOrderId: 'so-1',
  saleOrderRef: 'SO-2026-0004',
  customerId: 'c-1',
  customerName: 'Turaco Kenya Ltd',
  status: 'done',
  date: '2026-08-02',
  lines: [
    {
      productId: 'p-1',
      productName: 'Dell XPS 13 9310',
      qty: 2,
      qtyDone: 2,
      serialIds: ['s-1', 's-2'],
    },
    {
      productId: 'p-2',
      productName: 'USB-C Hub',
      qty: 1,
      qtyDone: 1,
      serialIds: [],
    },
  ],
  warrantyCreated: false,
}

const serials: SerialNumber[] = [
  {
    id: 's-1',
    serial: 'SN-AAA-001',
    productId: 'p-1',
    productName: 'Dell XPS 13 9310',
    location: 'shop',
    status: 'sold',
    receivedDate: '2026-01-01',
    barcode: 'SN-AAA-001',
    specs: '16GB RAM, 512GB SSD, i7-1185G7',
  },
  {
    id: 's-2',
    serial: 'SN-AAA-002',
    productId: 'p-1',
    productName: 'Dell XPS 13 9310',
    location: 'shop',
    status: 'sold',
    receivedDate: '2026-01-01',
    barcode: 'SN-AAA-002',
    // no specs — fall back to product description
    accessories: ['Charger', 'Sleeve'],
  },
]

const products = [
  { id: 'p-1', name: 'Dell XPS 13 9310', description: 'Intel Core i7, 16GB LPDDR4x, 512GB NVMe' },
  { id: 'p-2', name: 'USB-C Hub', description: '7-in-1 USB-C hub, 100W PD' },
]

describe('resolveDeliveryUnitSpecs', () => {
  it('prefers serial specs over product description', () => {
    expect(resolveDeliveryUnitSpecs(serials[0], products[0])).toBe('16GB RAM, 512GB SSD, i7-1185G7')
  })

  it('falls back to product description then accessories', () => {
    expect(resolveDeliveryUnitSpecs(serials[1], products[0])).toBe(
      'Intel Core i7, 16GB LPDDR4x, 512GB NVMe',
    )
    expect(resolveDeliveryUnitSpecs(
      { ...serials[1], accessories: ['Charger', 'Sleeve'] },
      { description: '' },
    )).toBe('Charger, Sleeve')
  })
})

describe('buildDeliveryNoteLines', () => {
  it('expands serials and fills specs from serial or product', () => {
    const lines = buildDeliveryNoteLines(delivery, serials, products)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({
      description: 'Dell XPS 13 9310',
      qty: 1,
      serial: 'SN-AAA-001',
      specs: '16GB RAM, 512GB SSD, i7-1185G7',
    })
    expect(lines[1]).toMatchObject({
      serial: 'SN-AAA-002',
      specs: 'Intel Core i7, 16GB LPDDR4x, 512GB NVMe',
    })
    expect(lines[2]).toMatchObject({
      description: 'USB-C Hub',
      qty: 1,
      specs: '7-in-1 USB-C hub, 100W PD',
    })
  })
})

describe('delivery note commercial PDF', () => {
  it('builds input for the shared Deed downloadable template with specs', () => {
    const input = buildDeliveryNotePdfInput(
      delivery,
      serials,
      {
        recipientName: 'Jane Wanjiku',
        recipientPhone: '+254700000000',
        recipientIdNumber: '12345678',
        deliveryAddress: 'Westlands, Nairobi',
        notes: 'Handle with care',
      },
      products,
    )
    expect(input.title).toBe('Delivery Note')
    expect(input.hideAmounts).toBe(true)
    expect(input.deliveryNoteLayout).toBe(true)
    expect(input.attention).toBe('Jane Wanjiku')
    expect(input.recipientIdNumber).toBe('12345678')
    expect(input.lines[0].specs).toContain('16GB')
    expect(input.lines[1].specs).toContain('Intel Core i7')

    const doc = buildDeedDocumentPdf(input, company, [])
    const asString = Buffer.from(doc.output('arraybuffer')).toString('latin1')
    expect(String.fromCharCode(...new Uint8Array(doc.output('arraybuffer')).slice(0, 5))).toBe('%PDF-')
    expect(asString).toContain('DELIVERY NOTE')
    expect(asString).toContain('SERIAL / IMEI')
    expect(asString).toContain('SPECS')
    expect(asString).toContain('SN-AAA-001')
    expect(asString).toContain('16GB RAM')
    expect(asString).toContain('RECEIPT ACKNOWLEDGEMENT')
    expect(asString).toContain('Jane Wanjiku')
  })
})
