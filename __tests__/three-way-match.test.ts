import { describe, it, expect } from 'vitest'
import {
  assertBillableQty,
  assertVendorBillThreeWayMatch,
  billableQty,
  billMatchStatus,
  summarizePoThreeWayMatch,
} from '@/lib/purchase/three-way-match'

describe('three-way match', () => {
  it('computes billable qty as received minus billed', () => {
    expect(billableQty({ qtyReceived: 10, qtyBilled: 3 })).toBe(7)
    expect(billableQty({ qtyReceived: 5, qtyBilled: 5 })).toBe(0)
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

  it('asserts vendor bill lines against PO by productId', () => {
    const poLines = [
      { productId: 'p1', qtyOrdered: 10, qtyReceived: 8, qtyBilled: 2 },
      { productId: 'p2', qtyOrdered: 5, qtyReceived: 5, qtyBilled: 0 },
    ]
    expect(() => assertVendorBillThreeWayMatch({
      poLines,
      billLines: [{ productId: 'p1', qty: 6 }, { productId: 'p2', qty: 5 }],
    })).not.toThrow()

    expect(() => assertVendorBillThreeWayMatch({
      poLines,
      billLines: [{ productId: 'p1', qty: 7 }],
    })).toThrow(/3-way match failed/)

    expect(() => assertVendorBillThreeWayMatch({
      poLines,
      billLines: [{ productId: 'missing', qty: 1 }],
    })).toThrow(/not found on purchase order/)
  })

  it('summarizes PO match', () => {
    const summary = summarizePoThreeWayMatch([
      { productId: 'p1', qtyOrdered: 10, qtyReceived: 10, qtyBilled: 10 },
    ])
    expect(summary.status).toBe('matched')
  })
})
