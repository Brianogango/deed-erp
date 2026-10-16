import { describe, it, expect } from 'vitest'
import { findSalesStockGaps } from '@/lib/inventory/sales-stock-gaps'

const base = {
  serials: [
    { id: 's1', productId: 'p1', serial: 'SN-1', status: 'sold', location: 'customer' },
    { id: 's2', productId: 'p1', serial: 'SN-2', status: 'available', location: 'warehouse' },
    { id: 's3', productId: 'p1', serial: 'SN-3', status: 'available', location: 'warehouse' },
  ],
  products: [{ id: 'p1', requiresSerial: true }, { id: 'p2', requiresSerial: false }],
  posOrders: [], deliveries: [], kilimallDispatches: [], stockMoves: [],
}

describe('findSalesStockGaps()', () => {
  it('reports nothing when every sold serial is sold', () => {
    const r = findSalesStockGaps({ ...base, kilimallDispatches: [{ status: 'dispatched', orderRef: 'KO/1', serialId: 's1', productId: 'p1' }] })
    expect(r.gaps).toEqual([])
    expect(r.checked.kilimallDispatches).toBe(1)
  })

  it('flags a dispatched Kilimall serial, a till serial and a delivered serial that are not sold', () => {
    const r = findSalesStockGaps({
      ...base,
      kilimallDispatches: [{ status: 'dispatched', orderRef: 'KO/2', productName: 'Phone', serialId: 's2', productId: 'p1' }],
      posOrders: [{ ref: 'POS/1', date: '2026-10-01', lines: [{ productId: 'p1', productName: 'Phone', qty: 1, serialId: 's3' }] }],
      deliveries: [{ ref: 'DN/1', status: 'done', lines: [{ productId: 'p1', productName: 'Phone', qty: 1, qtyDone: 1, serialIds: ['gone'] }] }],
    })
    expect(r.gaps.map(g => [g.channel, g.documentRef, g.problem])).toEqual([
      ['kilimall', 'KO/2', 'serial_not_sold'],
      ['pos', 'POS/1', 'serial_not_sold'],
      ['delivery', 'DN/1', 'serial_missing'],
    ])
  })

  it('flags quantity-stock sales that left no stock move, and ignores ones that did', () => {
    const r = findSalesStockGaps({
      ...base,
      posOrders: [
        { ref: 'POS/2', lines: [{ productId: 'p2', productName: 'Cable', qty: 2 }] },
        { ref: 'POS/3', lines: [{ productId: 'p2', productName: 'Cable', qty: 1 }] },
      ],
      stockMoves: [{ documentRef: 'POS/3' }],
    })
    expect(r.gaps.map(g => [g.documentRef, g.problem])).toEqual([['POS/2', 'no_stock_move']])
  })
})
