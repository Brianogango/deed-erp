import { describe, expect, it } from 'vitest'
import { computeSaleOrderApprovalTriggers, lineGrossMarginPercent } from '@/lib/sales/margin-approval'

describe('margin / floor approval automation', () => {
  it('computes gross margin after discount', () => {
    expect(lineGrossMarginPercent({ unitPrice: 1000, costPrice: 700, discountPercent: 0 })).toBeCloseTo(30)
    expect(lineGrossMarginPercent({ unitPrice: 1000, costPrice: 700, discountPercent: 20 })).toBeCloseTo(12.5)
  })

  it('flags below-cost floor and low margin as special_pricing', () => {
    const triggers = computeSaleOrderApprovalTriggers({
      lines: [
        { productId: 'p1', productName: 'Laptop', qty: 1, unitPrice: 800, discount: 0 },
      ],
      products: [
        { id: 'p1', name: 'Laptop', costPrice: 900, trackStock: true, salePrice: 1200, sellingPrice: 1200 },
      ],
      orderTotal: 800,
      minMarginPercent: 10,
    })
    expect(triggers.some(t => t.type === 'special_pricing')).toBe(true)
    expect(triggers.find(t => t.type === 'special_pricing')?.details.belowCost).toBe(true)
  })

  it('flags high line discount for discount approval', () => {
    const triggers = computeSaleOrderApprovalTriggers({
      lines: [
        { productId: 'p1', qty: 1, unitPrice: 1000, discount: 15, subtotal: 850 },
      ],
      products: [
        { id: 'p1', costPrice: 100, trackStock: true, salePrice: 1000, sellingPrice: 1000 },
      ],
      orderTotal: 850,
      minMarginPercent: 0,
    })
    expect(triggers.some(t => t.type === 'discount')).toBe(true)
  })
})
