/**
 * Apply margin-from-cost policy to produce a list/sale price for a product.
 * Shared by Inventory UI, product write paths, GRN cost sync, and reconfiguration.
 */

import { calculateMarginQuote, suggestedListPriceFromQuote } from '@/lib/pricing/margin-calculator'
import {
  DEFAULT_PRICING_MARGIN_POLICY,
  normalizePricingMarginPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'
import { suggestSalePriceFromCost } from '@/lib/sale-price-calculator'

export function resolveListSaleFromMargin(opts: {
  costPrice: number
  erpCategory?: string | null
  pricingCategoryId?: string | null
  productType?: 'new' | 'refurbished' | string | null
  productKind?: string | null
  unit?: string | null
  policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
  legacyMarkupMap?: Partial<Record<string, number>> | null
}): { salePrice: number | null; quoteOk: boolean; reason?: string } {
  const kind = String(opts.productKind || '').toLowerCase()
  const unit = String(opts.unit || '').toLowerCase()
  const category = String(opts.erpCategory || '')
  if (kind === 'service' || unit === 'service' || category === 'Services') {
    return { salePrice: null, quoteOk: false, reason: 'Services stay manually priced' }
  }

  const cost = Number(opts.costPrice)
  if (!Number.isFinite(cost) || cost <= 0) {
    return { salePrice: null, quoteOk: false, reason: 'Cost required' }
  }

  const policy = normalizePricingMarginPolicy(opts.policy ?? DEFAULT_PRICING_MARGIN_POLICY)
  if (!policy.enabled) {
    const legacy = suggestSalePriceFromCost(opts.legacyMarkupMap ?? null, opts.erpCategory, cost)
    return { salePrice: legacy, quoteOk: false, reason: 'Policy disabled' }
  }

  const quote = calculateMarginQuote({
    policy,
    buyCostKes: cost,
    erpCategory: opts.erpCategory,
    pricingCategoryId: opts.pricingCategoryId,
    productType: opts.productType,
  })
  if (quote.ok) {
    return { salePrice: suggestedListPriceFromQuote(quote), quoteOk: true }
  }

  const legacy = suggestSalePriceFromCost(opts.legacyMarkupMap ?? null, opts.erpCategory, cost)
  return { salePrice: legacy, quoteOk: false, reason: quote.error }
}

/** Classic markup % that approximates the max-band list price (for reconfig cost_plus fallback). */
export function impliedMarkupPctFromMargin(opts: {
  costPrice: number
  erpCategory?: string | null
  pricingCategoryId?: string | null
  productType?: 'new' | 'refurbished' | string | null
  productKind?: string | null
  unit?: string | null
  policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
  legacyMarkupMap?: Partial<Record<string, number>> | null
}): number | null {
  const resolved = resolveListSaleFromMargin(opts)
  if (resolved.salePrice == null || !(opts.costPrice > 0)) return null
  return ((resolved.salePrice / opts.costPrice) - 1) * 100
}

/**
 * cost_plus list for reconfiguration: prefer rounded margin-policy list;
 * fall back to 25% markup when the product is unmapped / policy off.
 */
export function resolveCostPlusListPrice(opts: {
  costPrice: number
  erpCategory?: string | null
  pricingCategoryId?: string | null
  productType?: 'new' | 'refurbished' | string | null
  productKind?: string | null
  unit?: string | null
  policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
  legacyMarkupMap?: Partial<Record<string, number>> | null
  fallbackMarkupPct?: number
}): number {
  const resolved = resolveListSaleFromMargin(opts)
  if (resolved.salePrice != null) return resolved.salePrice
  const cost = Number(opts.costPrice) || 0
  const pct = Number(opts.fallbackMarkupPct ?? 25) || 25
  return Math.max(0, Math.round(cost * (1 + pct / 100) * 100) / 100)
}
