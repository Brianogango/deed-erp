import { describe, expect, it } from 'vitest'
import { buildReorderDraftPos, qtyToReorder } from '@/lib/inventory/reorder-draft-pos'

describe('reorder draft POs', () => {
  it('orders at least the deficit / configured reorder qty', () => {
    expect(qtyToReorder({ id: '1', name: 'A', minStock: 5, reorderQty: 10 }, 2)).toBe(10)
    expect(qtyToReorder({ id: '1', name: 'A', minStock: 5 }, 2)).toBe(5)
    expect(qtyToReorder({ id: '1', name: 'A', minStock: 5 }, 6)).toBe(0)
  })

  it('groups by preferred vendor and leaves unassigned bucket', () => {
    const drafts = buildReorderDraftPos(
      [
        { id: 'p1', name: 'Mouse', minStock: 4, costPrice: 500, preferredVendorId: 'v1', preferredVendorName: 'Acme' },
        { id: 'p2', name: 'Cable', minStock: 3, costPrice: 100 },
      ],
      id => (id === 'p1' ? 1 : 0),
    )
    expect(drafts).toHaveLength(2)
    const acme = drafts.find(d => d.vendorId === 'v1')
    expect(acme?.lines[0].productName).toBe('Mouse')
    expect(drafts.find(d => !d.vendorId)?.lines[0].productName).toBe('Cable')
  })
})
