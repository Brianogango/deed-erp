import { describe, expect, it } from 'vitest'
import {
  filterPosHistoryOrders,
  formatPosReceiptProduct,
  resolvePosLineSerial,
  ticketLines,
  type PosHistoryTicket,
} from '@/lib/pos-transaction-history'

function order(partial: Partial<PosHistoryTicket> & Pick<PosHistoryTicket, 'id' | 'ref'>): PosHistoryTicket {
  return {
    lines: [],
    payment: 'mpesa',
    date: '2026-08-14',
    ...partial,
  }
}

describe('filterPosHistoryOrders', () => {
  const eliteBook = order({
    id: '17',
    ref: 'POS/0017',
    invoiceRef: 'INV/2026/0082',
    createdAt: '2026-08-14T07:20:00.000Z',
    customerName: 'Walk-in',
    lines: [{ productName: 'HP EliteBook 845 G7' }],
  })
  const proBook = order({
    id: '18',
    ref: 'POS/0018',
    invoiceRef: 'INV/2026/0085',
    createdAt: '2026-08-14T10:30:00.000Z',
    lines: [{ productName: 'HP ProBook 11 G5 EE' }],
  })
  const eliteBookLater = order({
    id: '19',
    ref: 'POS/0019',
    invoiceRef: 'INV/2026/0087',
    createdAt: '2026-08-14T12:21:00.000Z',
    customerName: 'Walk-in',
    lines: [{ productName: 'HP EliteBook 845 G7' }],
  })

  it('keeps POS/0017 and POS/0019 as separate tickets', () => {
    const rows = filterPosHistoryOrders([eliteBook, eliteBookLater], '')
    expect(rows.map(r => r.ref)).toEqual(['POS/0019', 'POS/0017'])
    expect(rows[0].invoiceRef).toBe('INV/2026/0087')
    expect(rows[1].invoiceRef).toBe('INV/2026/0082')
  })

  it('sorts newest first', () => {
    const rows = filterPosHistoryOrders([eliteBook, proBook, eliteBookLater], '')
    expect(rows.map(r => r.ref)).toEqual(['POS/0019', 'POS/0018', 'POS/0017'])
  })

  it('filters by invoice or product without collapsing same-SKU sales', () => {
    const byInvoice = filterPosHistoryOrders([eliteBook, eliteBookLater], '0082')
    expect(byInvoice.map(r => r.ref)).toEqual(['POS/0017'])

    const byProduct = filterPosHistoryOrders([eliteBook, proBook, eliteBookLater], 'elitebook')
    expect(byProduct.map(r => r.ref)).toEqual(['POS/0019', 'POS/0017'])
  })
})

describe('ticketLines', () => {
  it('summarizes extra lines', () => {
    expect(ticketLines(order({
      id: '1',
      ref: 'POS/0001',
      lines: [
        { productName: 'EliteBook' },
        { productName: 'Mouse' },
      ],
    }))).toBe('EliteBook +1')
  })

  it('includes the serial on serialized products', () => {
    expect(ticketLines(order({
      id: '2',
      ref: 'POS/0002',
      lines: [{ productName: 'HP EliteBook 845 G7', serialNumber: '5CD1234ABC' }],
    }))).toBe('HP EliteBook 845 G7 · SN 5CD1234ABC')
  })
})

describe('resolvePosLineSerial', () => {
  it('prefers the number stored on the till line', () => {
    expect(resolvePosLineSerial({
      productName: 'EliteBook',
      serialId: 'sid-1',
      serialNumber: '5CD1234ABC',
    }, [{ id: 'sid-1', serial: 'OTHER' }])).toBe('5CD1234ABC')
  })

  it('falls back to the serial catalog when the ticket only has serialId', () => {
    expect(resolvePosLineSerial({
      productName: 'EliteBook',
      serialId: 'sid-1',
    }, [{ id: 'sid-1', serial: '5CD9999XYZ' }])).toBe('5CD9999XYZ')
  })

  it('falls back to the stock move for that receipt when the ticket omitted SN', () => {
    expect(resolvePosLineSerial(
      { productName: 'EliteBook', productId: 'elite-1' },
      [],
      [{ documentRef: 'POS/0017', productId: 'elite-1', serialNumbers: ['5CG1060M8D'] }],
      'POS/0017',
    )).toBe('5CG1060M8D')
  })
})

describe('formatPosReceiptProduct', () => {
  it('leaves non-serialized lines unchanged', () => {
    expect(formatPosReceiptProduct({ productName: 'Wireless Mouse' })).toBe('Wireless Mouse')
  })
})

describe('filterPosHistoryOrders serial search', () => {
  it('finds a ticket by serial number', () => {
    const rows = filterPosHistoryOrders([
      order({
        id: '17',
        ref: 'POS/0017',
        lines: [{ productName: 'HP EliteBook 845 G7', serialNumber: '5CD1234ABC' }],
      }),
    ], '5cd1234')
    expect(rows.map(r => r.ref)).toEqual(['POS/0017'])
  })
})
