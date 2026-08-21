import { describe, it, expect } from 'vitest'
import {
  calculateMarginQuote,
  lookupTierReduction,
  roundUpKes,
  suggestedListPriceFromQuote,
  suggestedWholesalePriceFromQuote,
} from '@/lib/pricing/margin-calculator'
import { DEFAULT_PRICING_MARGIN_POLICY, overheadRateFromPolicy } from '@/lib/pricing/margin-policy'
import { suggestSalePriceFromCost, quoteSalePriceFromCost } from '@/lib/sale-price-calculator'

describe('margin-calculator (Deed spreadsheet)', () => {
  it('computes overhead rate from revenue and overhead', () => {
    expect(overheadRateFromPolicy(DEFAULT_PRICING_MARGIN_POLICY)).toBeCloseTo(0.132, 6)
  })

  it('matches Calculator sheet for Repair Parts @ cost 5000', () => {
    const quote = calculateMarginQuote({
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      buyCostKes: 5000,
      pricingCategoryId: 'repair_parts',
    })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return

    expect(quote.overheadRatePct).toBeCloseTo(13.2, 5)
    expect(quote.tierReductionPct).toBe(0)
    expect(quote.min.pricingDivisor).toBeCloseTo(0.818, 6)
    expect(quote.max.pricingDivisor).toBeCloseTo(0.768, 6)
    expect(quote.min.sellExVat).toBeCloseTo(6112.469438, 4)
    expect(quote.max.sellExVat).toBeCloseTo(6510.416667, 4)
    expect(quote.min.invoiceIncVat).toBeCloseTo(7090.464548, 4)
    expect(quote.max.invoiceIncVat).toBeCloseTo(7552.083333, 4)
    // Round up by KES 500
    expect(quote.min.sellExVatRounded).toBe(6500)
    expect(quote.max.sellExVatRounded).toBe(7000)
    // Classic GP floor = overhead + effective min target
    expect(quote.approvalMinGrossMarginPct).toBeCloseTo(18.2, 5)
  })

  it('applies approximate VLOOKUP tier reduction on buy cost', () => {
    expect(lookupTier(0)).toBe(0)
    expect(lookupTier(30000)).toBe(0)
    expect(lookupTier(35001)).toBe(0.5)
    expect(lookupTier(60000)).toBe(7)
    expect(lookupTier(120000)).toBe(8.5)
    expect(lookupTier(250000)).toBe(14)
  })

  it('reduces target margins for large buy costs', () => {
    const quote = calculateMarginQuote({
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      buyCostKes: 60_000,
      pricingCategoryId: 'repair_parts',
    })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return
    expect(quote.tierReductionPct).toBe(7)
    expect(quote.min.effectiveMarginPct).toBeCloseTo(5 - 7, 6)
    expect(quote.max.effectiveMarginPct).toBeCloseTo(10 - 7, 6)
    expect(quote.min.pricingDivisor).toBeCloseTo(1 - 0.132 - (5 - 7) / 100, 6)
  })

  it('maps ERP categories to pricing bands', () => {
    const quote = calculateMarginQuote({
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      buyCostKes: 5000,
      erpCategory: 'Parts & Components',
    })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return
    expect(quote.category.id).toBe('repair_parts')
  })

  it('rejects divisor collapse when overhead + margin >= 100%', () => {
    const quote = calculateMarginQuote({
      policy: {
        ...DEFAULT_PRICING_MARGIN_POLICY,
        annualRevenueEstimateKes: 100,
        annualOverheadKes: 90,
        categories: [
          {
            id: 'x',
            name: 'X',
            minGpMarginPct: 20,
            maxGpMarginPct: 25,
          },
        ],
        categoryMap: [],
      },
      buyCostKes: 1000,
      pricingCategoryId: 'x',
    })
    expect(quote.ok).toBe(false)
  })

  it('suggests rounded max band as list price', () => {
    const quote = calculateMarginQuote({
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      buyCostKes: 5000,
      pricingCategoryId: 'repair_parts',
    })
    expect(suggestedListPriceFromQuote(quote)).toBe(7000)
    expect(suggestedWholesalePriceFromQuote(quote)).toBe(6500)
    expect(
      suggestSalePriceFromCost(null, 'Parts & Components', 5000, {
        policy: DEFAULT_PRICING_MARGIN_POLICY,
      }),
    ).toBe(7000)
  })

  it('falls back to legacy markup when category unmapped', () => {
    const result = quoteSalePriceFromCost({
      costPrice: 10000,
      erpCategory: 'Services',
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      legacyMarkupMap: { Services: 40 },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect('legacySale' in result && result.legacySale).toBe(14000)
  })

  it('roundUpKes steps correctly', () => {
    expect(roundUpKes(6112.47, 500)).toBe(6500)
    expect(roundUpKes(6500, 500)).toBe(6500)
    expect(roundUpKes(6500.01, 500)).toBe(7000)
  })
})

function lookupTier(cost: number) {
  return lookupTierReduction(cost, DEFAULT_PRICING_MARGIN_POLICY.tiers).reductionPct
}
