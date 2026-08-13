import { describe, it, expect } from 'vitest'
import {
  calcSalePriceFromCost,
  getCategoryMarkupPct,
  suggestSalePriceFromCost,
  autoSalePriceFromCost,
} from '@/lib/sale-price-calculator'
import { DEFAULT_PRICING_MARGIN_POLICY } from '@/lib/pricing/margin-policy'

describe('sale-price-calculator', () => {
  it('computes markup on cost rounded to whole KES', () => {
    expect(calcSalePriceFromCost(10000, 25)).toBe(12500)
    expect(calcSalePriceFromCost(9999, 10)).toBe(10999)
    expect(calcSalePriceFromCost(100, 0)).toBe(100)
  })

  it('reads configured category markup and ignores blanks', () => {
    const map = { Laptops: 30, Accessories: 0 }
    expect(getCategoryMarkupPct(map, 'Laptops')).toBe(30)
    expect(getCategoryMarkupPct(map, 'Accessories')).toBe(0)
    expect(getCategoryMarkupPct(map, 'Services')).toBeNull()
    expect(getCategoryMarkupPct(undefined, 'Laptops')).toBeNull()
  })

  it('suggests sale price from legacy markup when no policy passed', () => {
    const map = { Accessories: 40 }
    expect(suggestSalePriceFromCost(map, 'Accessories', 2500)).toBe(3500)
    expect(suggestSalePriceFromCost(map, 'Laptops', 2500)).toBeNull()
    expect(suggestSalePriceFromCost(map, 'Accessories', '')).toBeNull()
  })

  it('prefers margin policy list price when policy is passed', () => {
    expect(
      suggestSalePriceFromCost(null, 'Parts & Components', 5000, {
        policy: DEFAULT_PRICING_MARGIN_POLICY,
      }),
    ).toBe(7000)
  })

  it('always fills a sale price from cost even without category mapping', () => {
    expect(autoSalePriceFromCost(null, 'UnknownCat', 7000)).toBe(10000)
    expect(autoSalePriceFromCost({ Accessories: 40 }, 'Accessories', 2500)).toBe(3500)
  })
})
