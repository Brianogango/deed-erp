import { describe, expect, it } from 'vitest'
import type { Receipt, SerialNumber } from '@/lib/store'
import {
  receiptLineViews,
  receiptQtyReceived,
  receiptSearchBlob,
  receiptSerialCount,
} from '@/lib/purchase/receipt-contents'

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'rec-1',
    ref: 'REC/2026/0071',
    poId: 'po-1',
    poRef: 'PO/2026/0076',
    vendorId: 'v-1',
    vendorName: 'Reer Global Computer',
    status: 'validated',
    date: '2026-08-24',
    destinationLocation: 'warehouse',
    lines: [
      {
        productId: 'p-1',
        productName: 'Epson L3250',
        qtyExpected: 2,
        qtyReceived: 2,
        requiresSerial: true,
        serials: ['EP001', 'EP002'],
        specs: 'Printer',
      },
    ],
    ...overrides,
  }
}

function serial(overrides: Partial<SerialNumber>): SerialNumber {
  return {
    id: 's-1',
    serial: 'EP001',
    productId: 'p-1',
    productName: 'Epson L3250',
    location: 'warehouse',
    status: 'available',
    receivedDate: '2026-08-24',
    barcode: 'EP001',
    receiptId: 'rec-1',
    accessories: ['Charger', 'Box'],
    accessoryNotes: 'Box scuffed',
    specs: 'Wi-Fi inkjet',
    ...overrides,
  }
}

describe('receipt contents', () => {
  it('counts serials and received qty from GRN lines', () => {
    const rec = receipt()
    expect(receiptSerialCount(rec)).toBe(2)
    expect(receiptQtyReceived(rec)).toBe(2)
  })

  it('joins live serial records onto GRN line serials', () => {
    const views = receiptLineViews(receipt(), [serial({}), serial({ id: 's-2', serial: 'EP002', accessories: ['Cable'] })])
    expect(views[0].serials).toHaveLength(2)
    expect(views[0].serials[0]).toMatchObject({
      serial: 'EP001',
      specs: 'Wi-Fi inkjet',
      accessories: ['Charger', 'Box'],
      accessoryNotes: 'Box scuffed',
      status: 'available',
    })
    expect(views[0].serials[1].accessories).toEqual(['Cable'])
  })

  it('falls back to line specs when the serial record has none', () => {
    const views = receiptLineViews(receipt(), [serial({ specs: undefined })])
    expect(views[0].serials[0].specs).toBe('Printer')
  })

  it('appends serials linked to the GRN that are missing from the line list', () => {
    const views = receiptLineViews(
      receipt({ lines: [{ ...receipt().lines[0], serials: ['EP001'] }] }),
      [serial({}), serial({ id: 's-3', serial: 'EP-EXTRA' })],
    )
    expect(views[0].serials.map(s => s.serial)).toEqual(['EP001', 'EP-EXTRA'])
  })

  it('includes serials in the list search blob', () => {
    expect(receiptSearchBlob(receipt())).toContain('EP001')
    expect(receiptSearchBlob(receipt())).toContain('Epson L3250')
  })
})
