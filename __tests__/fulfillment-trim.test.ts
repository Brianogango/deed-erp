import { describe, expect, it } from 'vitest'
import {
  canTrimFulfillmentQty,
  isFulfillmentQtyTrim,
  trimSaleOrderLinesToDelivered,
} from '@/lib/sales/fulfillment-trim'

describe('trimSaleOrderLinesToDelivered', () => {
  it('reduces ordered qty to delivered and drops untouched lines', () => {
    const result = trimSaleOrderLinesToDelivered([
      { id: 'sec', lineType: 'section', productName: 'Hardware', qty: 0 },
      { id: 'a', productId: 'p1', qty: 5, qtyDelivered: 2, qtyInvoiced: 0, unitPrice: 1000, taxRate: 16 },
      { id: 'b', productId: 'p2', qty: 1, qtyDelivered: 0, qtyInvoiced: 0, unitPrice: 200, taxRate: 16 },
    ])
    expect(result.changed).toBe(true)
    expect(result.lines.map(l => l.id)).toEqual(['sec', 'a'])
    expect(result.lines.find(l => l.id === 'a')?.qty).toBe(2)
    expect(result.lines.find(l => l.id === 'a')?.lineTotal).toBe(2000)
  })

  it('never reduces below already-invoiced qty', () => {
    const result = trimSaleOrderLinesToDelivered([
      { id: 'a', productId: 'p1', qty: 5, qtyDelivered: 1, qtyInvoiced: 3, unitPrice: 100, taxRate: 0 },
    ])
    expect(result.lines[0].qty).toBe(3)
  })
})

describe('isFulfillmentQtyTrim', () => {
  const existing = {
    items: [
      { id: 'a', description: 'Laptop', qty: 5, unitPrice: 1000, taxRate: 16, lineTotal: 5000, qtyDelivered: 2, qtyInvoiced: 0 },
      { id: 'b', description: 'Mouse', qty: 1, unitPrice: 200, taxRate: 16, lineTotal: 200, qtyDelivered: 0, qtyInvoiced: 0 },
    ],
  }

  it('accepts reducing qty to delivered and dropping a zero-delivered line', () => {
    expect(isFulfillmentQtyTrim(existing, {
      fulfillmentTrim: true,
      lines: [
        { id: 'a', qty: 2, unitPrice: 1000, taxRate: 16, qtyDelivered: 2, qtyInvoiced: 0 },
      ],
    })).toBe(true)
  })

  it('rejects a price change even with the trim flag', () => {
    expect(isFulfillmentQtyTrim(existing, {
      fulfillmentTrim: true,
      lines: [
        { id: 'a', qty: 2, unitPrice: 9999, taxRate: 16, qtyDelivered: 2 },
        { id: 'b', qty: 1, unitPrice: 200, taxRate: 16 },
      ],
    })).toBe(false)
  })

  it('rejects dropping a line that already has delivered qty', () => {
    expect(isFulfillmentQtyTrim(existing, {
      fulfillmentTrim: true,
      lines: [
        { id: 'b', qty: 1, unitPrice: 200, taxRate: 16, qtyDelivered: 0 },
      ],
    })).toBe(false)
  })

  it('requires the explicit trim flag', () => {
    expect(isFulfillmentQtyTrim(existing, {
      lines: [{ id: 'a', qty: 2, unitPrice: 1000, taxRate: 16, qtyDelivered: 2 }],
    })).toBe(false)
  })
})

describe('canTrimFulfillmentQty', () => {
  it('matches inventory validators, not sales reps', () => {
    expect(canTrimFulfillmentQty('inventory_officer')).toBe(true)
    expect(canTrimFulfillmentQty('director')).toBe(true)
    expect(canTrimFulfillmentQty('sales_rep')).toBe(false)
  })
})
