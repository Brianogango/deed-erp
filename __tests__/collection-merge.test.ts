import { describe, it, expect } from 'vitest'
import { mergeCollectionById } from '@/lib/collection-merge'
import { computeLowStockItems, isStockOutMove } from '@/lib/kpi-stock'

describe('mergeCollectionById()', () => {
  it('unions by id so a short page cannot shrink the store', () => {
    const current = [{ id: 'a', n: 1 }, { id: 'b', n: 1 }]
    const incoming = [{ id: 'b', n: 2 }, { id: 'c', n: 1 }]
    expect(mergeCollectionById(current, incoming)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'c', n: 1 },
    ])
  })

  it('keeps current when incoming is empty', () => {
    const current = [{ id: 'a' }]
    expect(mergeCollectionById(current, [])).toEqual(current)
    expect(mergeCollectionById(current, null)).toEqual(current)
  })
})

describe('computeLowStockItems() / isStockOutMove()', () => {
  it('attaches on-hand and keeps only SKUs at or below min', () => {
    const products = [
      { id: 'low', isActive: true, minStock: 3, unit: 'pcs', requiresSerial: false },
      { id: 'ok', isActive: true, minStock: 3, unit: 'pcs', requiresSerial: false },
    ]
    const bulk = [
      { productId: 'low', location: 'warehouse' as const, qty: 1 },
      { productId: 'ok', location: 'warehouse' as const, qty: 10 },
    ]
    const items = computeLowStockItems(products, [], bulk)
    expect(items.map(p => p.id)).toEqual(['low'])
    expect(items[0].onHand).toBe(1)
  })

  it('treats out and return moves as stock-out', () => {
    expect(isStockOutMove({ type: 'out' })).toBe(true)
    expect(isStockOutMove({ type: 'return' })).toBe(true)
    expect(isStockOutMove({ type: 'in' })).toBe(false)
    expect(isStockOutMove({ type: 'OUT' })).toBe(true)
  })
})
