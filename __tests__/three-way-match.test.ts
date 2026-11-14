import { describe, it, expect } from 'vitest'
import { assertBillableQty, billableQty, billMatchStatus, poHasReceivedGoods } from '@/lib/purchase/three-way-match'

describe('three-way match', () => {
  it('computes billable qty as received minus billed', () => {
    expect(billableQty({ qtyReceived: 10, qtyBilled: 3 })).toBe(7)
    expect(billableQty({ qtyReceived: 5, qtyBilled: 5 })).toBe(0)
  })

  it('treats Prisma-hydrated qtyReceived as goods received even without a blob GRN', () => {
    expect(poHasReceivedGoods([{ qtyReceived: 1, qtyBilled: 0 }])).toBe(true)
    expect(poHasReceivedGoods([{ qtyReceived: 0, qtyBilled: 0 }])).toBe(false)
    expect(poHasReceivedGoods([])).toBe(false)
  })

  it('blocks over-billing', () => {
    expect(() => assertBillableQty({ qtyReceived: 5, qtyBilled: 2 }, 4)).toThrow(/only 3/)
    expect(() => assertBillableQty({ qtyReceived: 5, qtyBilled: 0 }, 5)).not.toThrow()
  })

  it('reports match status', () => {
    expect(billMatchStatus({ qtyOrdered: 10, qtyReceived: 0, qtyBilled: 0 })).toBe('pending_receipt')
    expect(billMatchStatus({ qtyOrdered: 10, qtyReceived: 5, qtyBilled: 5 })).toBe('matched')
    expect(billMatchStatus({ qtyOrdered: 10, qtyReceived: 5, qtyBilled: 6 })).toBe('over_billed')
    expect(billMatchStatus({ qtyOrdered: 10, qtyReceived: 5, qtyBilled: 2 })).toBe('under_billed')
  })

  
  })
