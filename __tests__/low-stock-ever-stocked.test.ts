import { describe, expect, it } from 'vitest'
import { everStockedProductIds, isLowStockSku } from '@/lib/business-logic'
import { computeLowStockItems } from '@/lib/kpi-stock'

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, category: 'Accessories', unit: 'pcs', trackingMethod: 'quantity', isActive: true, minStock: 5, ...over,
}) as any

describe('low stock counts only products that were ever stocked', () => {
  it('a catalog item never bought, sold or received is not low stock', () => {
    expect(computeLowStockItems([product('never')], [], [], [])).toEqual([])
  })

  it('a sold-out item (no stock line left) is low because it was bought before', () => {
    const items = computeLowStockItems([product('cable')], [], [], [{ productId: 'cable' }])
    expect(items.map(i => i.id)).toEqual(['cable'])
  })

  it('an item with stock below its minimum is low', () => {
    const items = computeLowStockItems([product('mouse')], [], [{ productId: 'mouse', location: 'warehouse', qty: 2 } as any])
    expect(items.map(i => i.id)).toEqual(['mouse'])
  })

  it('ever-stocked comes from serials, stock lines and documents', () => {
    const ids = everStockedProductIds([{ productId: 'a' }], [{ productId: 'b' }], [{ productId: 'c' }, {}])
    expect([...ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('callers that do not say keep the old behaviour', () => {
    expect(isLowStockSku(product('x'), 0)).toBe(true)
    expect(isLowStockSku(product('x'), 0, false)).toBe(false)
  })
})
