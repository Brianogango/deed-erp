import { describe, it, expect } from 'vitest'
import {
  calcSalePriceFromCost,
  getCategoryMarkupPct,
  suggestSalePriceFromCost,
} from '@/lib/sale-price-calculator'

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

  it('suggests sale price only when markup is configured', () => {
    const map = { Accessories: 40 }
    expect(suggestSalePriceFromCost(map, 'Accessories', 2500)).toBe(3500)
    expect(suggestSalePriceFromCost(map, 'Laptops', 2500)).toBeNull()
    expect(suggestSalePriceFromCost(map, 'Accessories', '')).toBeNull()
  })
})
