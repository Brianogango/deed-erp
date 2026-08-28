import { describe, expect, it } from 'vitest'
import { computeSaleOrderApprovalTriggers, lineGrossMarginPercent } from '@/lib/sales/margin-approval'
import {
  APPROVAL_RULES,
  isSalesConfirmGatingApproval,
  isSpecialPricingApprovalRequired,
  salesConfirmGatingApprovalTypes,
} from '@/lib/sales-approval-rules'

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

  it('uses spreadsheet classic GP floor from margin policy', async () => {
    const { DEFAULT_PRICING_MARGIN_POLICY } = await import('@/lib/pricing/margin-policy')
    // Repair Parts @ 5000 → approval floor ≈ 18.2% classic GP.
    // Sell at 5600 → GP ≈ 10.7% → below floor.
    const triggers = computeSaleOrderApprovalTriggers({
      lines: [
        { productId: 'p1', productName: 'RAM 8GB', qty: 1, unitPrice: 5600, discount: 0 },
      ],
      products: [
        {
          id: 'p1',
          name: 'RAM 8GB',
          costPrice: 5000,
          trackStock: true,
          category: 'Parts & Components',
          salePrice: 7000,
          sellingPrice: 7000,
        },
      ],
      orderTotal: 5600,
      minMarginPercent: 10,
      pricingMarginPolicy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    const pricing = triggers.find(t => t.type === 'special_pricing')
    expect(pricing?.details.belowMargin).toBe(true)
    expect(Number(pricing?.details.minMarginPercent)).toBeGreaterThan(15)
  })
})

describe('special_pricing approval hold', () => {
  it('keeps the special_pricing ladder but does not gate confirm by default', () => {
    expect(APPROVAL_RULES.special_pricing({})).toEqual(['director', 'finance_officer'])
    expect(isSpecialPricingApprovalRequired(undefined)).toBe(false)
    expect(isSpecialPricingApprovalRequired({})).toBe(false)
    expect(isSpecialPricingApprovalRequired({ salesRequireSpecialPricingApproval: false })).toBe(false)
    expect(isSpecialPricingApprovalRequired({ salesRequireSpecialPricingApproval: true })).toBe(true)
    expect(salesConfirmGatingApprovalTypes(undefined)).not.toContain('special_pricing')
    expect(salesConfirmGatingApprovalTypes({ salesRequireSpecialPricingApproval: true })).toContain('special_pricing')
    expect(isSalesConfirmGatingApproval('special_pricing', undefined)).toBe(false)
    expect(isSalesConfirmGatingApproval('discount', undefined)).toBe(true)
  })
})
