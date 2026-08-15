import { describe, expect, it } from 'vitest'
import {
  filterPosHistoryOrders,
  ticketLines,
} from '@/components/pos/PosTransactionHistory'
import type { POSOrder } from '@/lib/store'

function order(partial: Partial<POSOrder> & Pick<POSOrder, 'id' | 'ref'>): POSOrder {
  return {
    sessionId: 'sess-1',
    lines: [],
    subtotal: 32000,
    taxTotal: 0,
    total: 32000,
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
    lines: [{
      productId: 'p1',
      productName: 'HP EliteBook 845 G7',
      barcode: 'EB845',
      qty: 1,
      price: 32000,
      subtotal: 32000,
    }],
  })
  const proBook = order({
    id: '18',
    ref: 'POS/0018',
    invoiceRef: 'INV/2026/0085',
    createdAt: '2026-08-14T10:30:00.000Z',
    total: 14000,
    subtotal: 14000,
    lines: [{
      productId: 'p2',
      productName: 'HP ProBook 11 G5 EE',
      barcode: 'PB11',
      qty: 1,
      price: 14000,
      subtotal: 14000,
    }],
  })
  const eliteBookLater = order({
    id: '19',
    ref: 'POS/0019',
    invoiceRef: 'INV/2026/0087',
    createdAt: '2026-08-14T12:21:00.000Z',
    customerName: 'Walk-in',
    lines: [{
      productId: 'p1',
      productName: 'HP EliteBook 845 G7',
      barcode: 'EB845',
      qty: 1,
      price: 32000,
      subtotal: 32000,
    }],
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
        { productId: 'a', productName: 'EliteBook', barcode: 'a', qty: 1, price: 1, subtotal: 1 },
        { productId: 'b', productName: 'Mouse', barcode: 'b', qty: 1, price: 0, subtotal: 0 },
      ],
    }))).toBe('EliteBook +1')
  })
})
