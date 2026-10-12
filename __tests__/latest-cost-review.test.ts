import { describe, expect, it } from 'vitest'
import { reviewSalePrice } from '@/lib/pricing/latest-cost-review'

// Legacy markup only (policy off): suggested = cost × (1 + markup).
const settings = { policy: { enabled: false }, legacyMarkupMap: { Laptops: 20 } }

describe('price review against the latest purchase cost', () => {
  it('uses the latest cost when there is one', () => {
    const r = reviewSalePrice({ salePrice: 48000, costPrice: 37500, latestCost: 40000, category: 'Laptops' }, settings)
    expect(r.basis).toBe('latest')
    expect(r.basisCost).toBe(40000)
    expect(r.suggested).toBe(48000)
    expect(r.needsReview).toBe(false)
  })

  it('flags a price below the latest cost', () => {
    const r = reviewSalePrice({ salePrice: 39000, costPrice: 37500, latestCost: 40000, category: 'Laptops' }, settings)
    expect(r.needsReview).toBe(true)
    expect(r.reason).toMatch(/below the latest cost/)
  })

  it('flags a price above cost but below the margin on the latest cost', () => {
    const r = reviewSalePrice({ salePrice: 45000, costPrice: 37500, latestCost: 40000, category: 'Laptops' }, settings)
    expect(r.needsReview).toBe(true)
    expect(r.suggested).toBe(48000)
  })

  it('falls back to the average cost when nothing was received yet', () => {
    const r = reviewSalePrice({ salePrice: 30000, costPrice: 35000, category: 'Laptops' }, settings)
    expect(r.basis).toBe('average')
    expect(r.needsReview).toBe(true)
  })

  it('does nothing without any cost', () => {
    expect(reviewSalePrice({ salePrice: 100, costPrice: 0 }, settings).needsReview).toBe(false)
  })
})
