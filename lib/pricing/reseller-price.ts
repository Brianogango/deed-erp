/**
 * Reseller / wholesale price for Partner API and Inventory.
 *
 * 1. Saved wholesalePrice > 0 is a manual override.
 * 2. Otherwise the margin-policy min GP band from cost (same spreadsheet as
 *    retail list, which uses the max band).
 * 3. Never fall back to walk-in retail. If neither override nor min band can
 *    be produced, there is no reseller price.
 * 4. Computed (not manual) wholesale is clamped so it never exceeds retail
 *    when a retail price is set.
 */

import { calculateMarginQuote, suggestedWholesalePriceFromQuote } from '@/lib/pricing/margin-calculator'
import {
  normalizePricingMarginPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'

export type ResellerPriceSource = 'manual' | 'min_band'

export interface ResolveResellerPriceArgs {
  cost: number | string | null | undefined
  salePrice?: number | string | null
  wholesalePrice?: number | string | null
  category?: string | null
  pricingCategoryId?: string | null
  productType?: 'new' | 'refurbished' | string | null
  productKind?: string | null
  unit?: string | null
  policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
}

export interface ResolveResellerPriceResult {
  price: number
  source: ResellerPriceSource
}

function asMoney(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function resolveResellerPrice(args: ResolveResellerPriceArgs): ResolveResellerPriceResult | null {
  const kind = String(args.productKind || '').toLowerCase()
  const unit = String(args.unit || '').toLowerCase()
  const category = String(args.category || '')
  const isService = kind === 'service' || unit === 'service' || category === 'Services'

  const manual = asMoney(args.wholesalePrice)
  if (manual > 0) {
    return { price: roundMoney(manual), source: 'manual' }
  }

  if (isService) return null

  const cost = asMoney(args.cost)
  if (!(cost > 0)) return null

  const policy = normalizePricingMarginPolicy(args.policy)
  if (!policy.enabled) return null

  const quote = calculateMarginQuote({
    policy,
    buyCostKes: cost,
    erpCategory: args.category,
    pricingCategoryId: args.pricingCategoryId,
    productType: args.productType,
  })
  const suggested = suggestedWholesalePriceFromQuote(quote)
  if (suggested == null || !(suggested > 0)) return null

  let price = suggested
  const sale = asMoney(args.salePrice)
  if (sale > 0 && price > sale) price = roundMoney(sale)

  if (!(price > 0)) return null
  return { price, source: 'min_band' }
}
