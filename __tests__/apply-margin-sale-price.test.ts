import { describe, it, expect } from 'vitest'
import {
  resolveListSaleFromMargin,
  resolveCostPlusListPrice,
  impliedMarkupPctFromMargin,
} from '@/lib/pricing/apply-margin-sale-price'
import { DEFAULT_PRICING_MARGIN_POLICY } from '@/lib/pricing/margin-policy'

describe('resolveListSaleFromMargin', () => {
  it('skips services', () => {
    const r = resolveListSaleFromMargin({
      costPrice: 5000,
      erpCategory: 'Services',
      productKind: 'service',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    expect(r.salePrice).toBeNull()
    expect(r.reason).toMatch(/manual/i)
  })

  it('quotes repair parts at spreadsheet list (round up 500)', () => {
    const r = resolveListSaleFromMargin({
      costPrice: 5000,
      pricingCategoryId: 'repair_parts',
      productType: 'refurbished',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    expect(r.quoteOk).toBe(true)
    expect(r.salePrice).toBe(7000)
  })

  it('maps refurbished Laptops to refurb band', () => {
    const r = resolveListSaleFromMargin({
      costPrice: 25000,
      erpCategory: 'Laptops',
      productType: 'refurbished',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    expect(r.quoteOk).toBe(true)
    expect(r.salePrice).toBeGreaterThan(25000)
  })
})

describe('resolveCostPlusListPrice', () => {
  it('returns rounded margin list for cost_plus', () => {
    const list = resolveCostPlusListPrice({
      costPrice: 5000,
      pricingCategoryId: 'repair_parts',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    expect(list).toBe(7000)
  })

  it('falls back to 25% when policy disabled and no legacy markup', () => {
    const list = resolveCostPlusListPrice({
      costPrice: 1000,
      erpCategory: 'Laptops',
      policy: { ...DEFAULT_PRICING_MARGIN_POLICY, enabled: false },
      legacyMarkupMap: null,
      fallbackMarkupPct: 25,
    })
    expect(list).toBe(1250)
  })
})

describe('impliedMarkupPctFromMargin', () => {
  it('returns positive markup for a quoted list', () => {
    const pct = impliedMarkupPctFromMargin({
      costPrice: 5000,
      pricingCategoryId: 'repair_parts',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
    })
    expect(pct).toBeCloseTo(((7000 / 5000) - 1) * 100, 5)
  })
})
