import { describe, it, expect } from 'vitest'
import { calculateMarginQuote, lookupTierReduction } from '@/lib/pricing/margin-calculator'
import { DEFAULT_PRICING_MARGIN_POLICY, resolvePricingCategoryId } from '@/lib/pricing/margin-policy'

const policy = DEFAULT_PRICING_MARGIN_POLICY

describe('margin spreadsheet completeness', () => {
  it('has all 13 spreadsheet categories', () => {
    expect(policy.categories).toHaveLength(13)
    const names = policy.categories.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'Accessories',
      'Consumer Electronics',
      'Refurb Desktops / Combos',
      'Refurb Laptops',
      'Monitors(New & Refurb)',
      'Networking',
      'Power Backup',
      'Printer Consumables',
      'Printers(New & Refurb)',
      'Repair Parts',
      'Servers',
      'Brand New PCs',
      'Software Licenses',
    ]))
  })

  it('has all 8 price tiers with spreadsheet reductions', () => {
    expect(policy.tiers.map(t => [t.priceFromKes, t.reductionPct])).toEqual([
      [0, 0],
      [35001, 0.5],
      [50001, 7],
      [90001, 7],
      [110001, 8.5],
      [130001, 12],
      [160001, 13],
      [200001, 14],
    ])
  })

  it('maps every spreadsheet category band min/max', () => {
    const expected: Record<string, [number, number]> = {
      accessories: [5, 10],
      consumer_electronics: [7, 10],
      refurb_desktops: [5, 10],
      refurb_laptops: [7, 12],
      monitors: [10, 15],
      networking: [20, 25],
      power_backup: [15, 20],
      printer_consumables: [15, 20],
      printers: [5, 10],
      repair_parts: [5, 10],
      servers: [15, 20],
      brand_new_pcs: [3, 5],
      software_licenses: [25, 30],
    }
    for (const [id, [min, max]] of Object.entries(expected)) {
      const cat = policy.categories.find(c => c.id === id)
      expect(cat, id).toBeTruthy()
      expect(cat!.minGpMarginPct).toBe(min)
      expect(cat!.maxGpMarginPct).toBe(max)
    }
  })

  it('resolves Brand New PCs for new laptops/desktops', () => {
    expect(resolvePricingCategoryId({ policy, erpCategory: 'Laptops', productType: 'new' })).toBe('brand_new_pcs')
    expect(resolvePricingCategoryId({ policy, erpCategory: 'Laptops', productType: 'refurbished' })).toBe('refurb_laptops')
    expect(resolvePricingCategoryId({ policy, erpCategory: 'Desktops', productType: 'new' })).toBe('brand_new_pcs')
    expect(resolvePricingCategoryId({ policy, erpCategory: 'Desktops', productType: 'refurbished' })).toBe('refurb_desktops')
  })

  it('computes sell band for every category at cost 5000', () => {
    for (const cat of policy.categories) {
      const quote = calculateMarginQuote({ policy, buyCostKes: 5000, pricingCategoryId: cat.id })
      expect(quote.ok, cat.id).toBe(true)
      if (!quote.ok) continue
      expect(quote.min.sellExVat).toBeGreaterThan(5000)
      expect(quote.max.sellExVat).toBeGreaterThanOrEqual(quote.min.sellExVat)
      expect(quote.min.invoiceIncVat).toBeCloseTo(quote.min.sellExVat * 1.16, 4)
      expect(quote.max.invoiceIncVat).toBeCloseTo(quote.max.sellExVat * 1.16, 4)
    }
  })

  it('tier VLOOKUP matches spreadsheet breakpoints', () => {
    const samples: Array<[number, number]> = [
      [0, 0], [29999, 0], [35000, 0], [35001, 0.5], [50000, 0.5],
      [50001, 7], [90000, 7], [90001, 7], [110000, 7], [110001, 8.5],
      [130000, 8.5], [130001, 12], [160000, 12], [160001, 13],
      [200000, 13], [200001, 14], [999999, 14],
    ]
    for (const [cost, expected] of samples) {
      expect(lookupTierReduction(cost, policy.tiers).reductionPct).toBe(expected)
    }
  })

  it('Networking @ 120000 applies 8.5% tier cut', () => {
    const quote = calculateMarginQuote({
      policy,
      buyCostKes: 120000,
      pricingCategoryId: 'networking',
    })
    expect(quote.ok).toBe(true)
    if (!quote.ok) return
    expect(quote.tierReductionPct).toBe(8.5)
    expect(quote.min.effectiveMarginPct).toBeCloseTo(20 - 8.5, 6)
    expect(quote.max.effectiveMarginPct).toBeCloseTo(25 - 8.5, 6)
    expect(quote.min.pricingDivisor).toBeCloseTo(1 - 0.132 - (20 - 8.5) / 100, 6)
    expect(quote.min.sellExVat).toBeCloseTo(120000 / quote.min.pricingDivisor, 4)
  })
})
