import { describe, expect, it } from 'vitest'
import { allocateReceiptToPoLines, billedQtyByPoLine } from '@/lib/purchase/receipt-allocation'

const po = [
  { id: 'a', productId: 'hp840', qty: 5, qtyReceived: 0, unitPrice: 50000 },
  { id: 'b', productId: 'hp840', qty: 3, qtyReceived: 0, unitPrice: 48000 },
  { id: 'c', productId: 'mouse', qty: 10, qtyReceived: 2, unitPrice: 500 },
]

describe('receipt allocation', () => {
  it('fills same-product lines in order instead of adding the total to each', () => {
    const r = allocateReceiptToPoLines(po, [{ productId: 'hp840', qtyReceived: 6 }])
    expect(r.lines.map(l => l.qtyReceived)).toEqual([5, 1, 2])
    expect(r.overReceived).toEqual([])
    // 5 × 50,000 + 1 × 48,000, averaged
    expect(r.unitCostByProduct.get('hp840')).toBe(49666.67)
  })

  it('a receipt line that names its PO line fills that one first', () => {
    const r = allocateReceiptToPoLines(po, [{ productId: 'hp840', qtyReceived: 2, poLineId: 'b' }])
    expect(r.lines.map(l => l.qtyReceived)).toEqual([0, 2, 2])
    expect(r.unitCostByProduct.get('hp840')).toBe(48000)
  })

  it('reports anything beyond what is still open', () => {
    const r = allocateReceiptToPoLines(po, [{ productId: 'mouse', qtyReceived: 9 }, { productId: 'ghost', qtyReceived: 1 }])
    expect(r.overReceived).toEqual([{ productId: 'mouse', qty: 1 }, { productId: 'ghost', qty: 1 }])
    expect(r.lines[2].qtyReceived).toBe(10)
  })
})

describe('billed per PO line', () => {
  const lines = [
    { id: 'a', productId: 'hp840', productName: 'HP 840', qty: 5 },
    { id: 'b', productId: 'hp840', productName: 'HP 840', qty: 3 },
  ]
  it('counts linked bill lines on their own PO line only', () => {
    const billed = billedQtyByPoLine(lines, [{ productId: 'hp840', purchaseOrderItemId: 'a', qty: 5 }])
    expect([billed.get('a'), billed.get('b')]).toEqual([5, 0])
  })
  it('spreads older product-only bill lines over the lines in order', () => {
    const billed = billedQtyByPoLine(lines, [{ productId: 'hp840', qty: 6 }, { description: 'HP 840 ×1', qty: 1 }])
    expect([billed.get('a'), billed.get('b')]).toEqual([5, 2])
  })
})
