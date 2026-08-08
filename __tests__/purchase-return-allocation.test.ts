import { describe, expect, it } from 'vitest'
import { allocatePurchaseReturn, type ReturnPoLine } from '@/lib/purchase/return-allocation'

const poLine = (over: Partial<ReturnPoLine> = {}): ReturnPoLine => ({
  id: 'pol-1',
  productId: 'prod-1',
  productName: 'HP EliteBook 840',
  qtyReceived: 5,
  qtyBilled: 0,
  unitPrice: 50_000,
  taxRate: 0,
  ...over,
})

describe('allocatePurchaseReturn', () => {
  it('returns of unbilled goods wind back qtyReceived and need no credit note', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine()],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 2 }],
      draftBills: [],
    })
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 3, qtyBilled: 0 }])
    expect(result.creditLines).toHaveLength(0)
    expect(result.creditTotal).toBe(0)
    expect(result.draftBillDeductions).toHaveLength(0)
  })

  it('returns of posted-billed goods produce a credit note with ZERO VAT when the PO line had no VAT', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyBilled: 5 })],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 1 }],
      draftBills: [],
    })
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 4, qtyBilled: 4 }])
    expect(result.creditLines).toEqual([
      expect.objectContaining({ qty: 1, unitPrice: 50_000, taxRate: 0, subtotal: 50_000, taxAmount: 0 }),
    ])
    expect(result.creditSubtotal).toBe(50_000)
    expect(result.creditTaxTotal).toBe(0)
    expect(result.creditTotal).toBe(50_000)
  })

  it('credit note VAT mirrors the PO line tax rate when the line was bought with VAT', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyBilled: 5, taxRate: 16 })],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 2 }],
      draftBills: [],
    })
    expect(result.creditSubtotal).toBe(100_000)
    expect(result.creditTaxTotal).toBe(16_000)
    expect(result.creditTotal).toBe(116_000)
    expect(result.creditLines[0].taxRate).toBe(16)
  })

  it('quantities billed on a draft bill are deducted from the draft instead of credited', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyBilled: 5 })],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 2 }],
      draftBills: [{ id: 'bill-1', lines: [{ id: 'bl-1', productId: 'prod-1', qty: 5 }] }],
    })
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 3, qtyBilled: 3 }])
    expect(result.draftBillDeductions).toEqual([{ billId: 'bill-1', lineId: 'bl-1', deductQty: 2 }])
    expect(result.creditLines).toHaveLength(0)
    expect(result.creditTotal).toBe(0)
  })

  it('splits a return across unbilled, draft-billed and posted-billed portions', () => {
    // received 6: 1 unbilled, 2 on a draft bill, 3 on a posted bill
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyReceived: 6, qtyBilled: 5 })],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 6 }],
      draftBills: [{ id: 'bill-draft', lines: [{ id: 'bl-1', productId: 'prod-1', qty: 2 }] }],
    })
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 0, qtyBilled: 0 }])
    expect(result.draftBillDeductions).toEqual([{ billId: 'bill-draft', lineId: 'bl-1', deductQty: 2 }])
    expect(result.creditLines).toEqual([expect.objectContaining({ qty: 3, subtotal: 150_000 })])
    expect(result.creditTotal).toBe(150_000)
  })

  it('never winds back more than was received and ignores unknown products', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyReceived: 1, qtyBilled: 1 })],
      returnLines: [
        { productId: 'prod-1', productName: 'HP EliteBook 840', qty: 4 },
        { productId: 'prod-unknown', productName: 'Ghost item', qty: 2 },
      ],
      draftBills: [],
    })
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 0, qtyBilled: 0 }])
    expect(result.creditLines).toEqual([expect.objectContaining({ qty: 1 })])
    expect(result.creditTotal).toBe(50_000)
  })

  it('handles several return lines of the same product cumulatively', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyReceived: 4, qtyBilled: 2 })],
      returnLines: [
        { productId: 'prod-1', productName: 'HP EliteBook 840', qty: 2 },
        { productId: 'prod-1', productName: 'HP EliteBook 840', qty: 2 },
      ],
      draftBills: [],
    })
    // First return consumes the 2 unbilled units, second consumes the 2 posted-billed ones.
    expect(result.poLineAdjustments).toEqual([{ poLineId: 'pol-1', qtyReceived: 0, qtyBilled: 0 }])
    expect(result.creditLines).toEqual([expect.objectContaining({ qty: 2, subtotal: 100_000 })])
  })

  it('rounds per-line VAT the same way vendor bills do', () => {
    const result = allocatePurchaseReturn({
      poLines: [poLine({ qtyBilled: 5, unitPrice: 333, taxRate: 16 })],
      returnLines: [{ productId: 'prod-1', productName: 'HP EliteBook 840', qty: 1 }],
      draftBills: [],
    })
    expect(result.creditTaxTotal).toBe(Math.round(333 * 16 / 100))
  })
})
