import { describe, it, expect } from 'vitest'
import { planQuantityReconcile } from '@/lib/inventory/stock-reconcile'

const P = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, costPrice: 100, trackingMethod: 'QUANTITY', ...extra })

describe('quantity stock: both sides take the lower number', () => {
  it('lowers the table when the database is higher', () => {
    const [row] = planQuantityReconcile({
      products: [P('stand')], serials: [],
      bulkStock: [{ productId: 'stand', location: 'warehouse', qty: 18 }],
      tableQty: new Map([['stand', 28]]),
    })
    expect(row).toMatchObject({ copyQty: 18, tableQty: 28, target: 18, tableCut: 10, copyCuts: [] })
  })

  it('lowers the screen copy from its largest location first when it is higher', () => {
    const [row] = planQuantityReconcile({
      products: [P('ram')], serials: [],
      bulkStock: [{ productId: 'ram', location: 'shop', qty: 2 }, { productId: 'ram', location: 'warehouse', qty: 7 }],
      tableQty: new Map([['ram', 5]]),
    })
    expect(row).toMatchObject({ copyQty: 9, target: 5, tableCut: 0, copyCuts: [{ location: 'warehouse', qty: 4 }] })
  })

  it('counts a missing table row as 0', () => {
    const [row] = planQuantityReconcile({
      products: [P('orphan')], serials: [],
      bulkStock: [{ productId: 'orphan', location: 'warehouse', qty: 2 }],
      tableQty: new Map(),
    })
    expect(row).toMatchObject({ target: 0, copyCuts: [{ location: 'warehouse', qty: 2 }] })
  })

  it('leaves serial-tracked products, matching rows and table-only products alone', () => {
    const rows = planQuantityReconcile({
      products: [P('laptop', { trackingMethod: 'SERIAL' }), P('dock'), P('same'), P('tableonly')],
      serials: [{ productId: 'dock' }],
      bulkStock: [
        { productId: 'laptop', location: 'warehouse', qty: 3 },
        { productId: 'dock', location: 'warehouse', qty: 3 },
        { productId: 'same', location: 'warehouse', qty: 4 },
      ],
      tableQty: new Map([['laptop', 9], ['dock', 9], ['same', 4], ['tableonly', 6]]),
    })
    expect(rows).toEqual([])
  })
})
