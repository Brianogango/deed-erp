import { quoteSalePriceFromCost } from '@/lib/sale-price-calculator'
import type { PricingMarginPolicy } from '@/lib/pricing/margin-policy'

type CategoryMarkupMap = Partial<Record<string, number>>

export type PriceReviewInput = {
  salePrice: number
  costPrice: number
  latestCost?: number
  category?: string | null
  pricingCategoryId?: string | null
  productType?: string | null
}

export type PriceReview = {
  /** Cost the suggestion is based on: the latest purchase cost, else the average. */
  basisCost: number
  basis: 'latest' | 'average'
  /** Suggested list price (margin policy maximum, or the legacy markup). */
  suggested: number | null
  /** Lowest price the margin policy allows on that cost. */
  minimum: number | null
  needsReview: boolean
  reason: string
}

/**
 * Selling-price check against what stock now costs to buy. Receipts no
 * longer change selling prices; a product lands on the price review list
 * when its price is below cost, or below the margin band, on the latest cost.
 */
export function reviewSalePrice(
  product: PriceReviewInput,
  settings: { policy?: Partial<PricingMarginPolicy> | null; legacyMarkupMap?: CategoryMarkupMap | null },
): PriceReview {
  const latest = Number(product.latestCost) || 0
  const average = Number(product.costPrice) || 0
  const basisCost = latest > 0 ? latest : average
  const basis = latest > 0 ? 'latest' : 'average'
  const sale = Number(product.salePrice) || 0
  if (basisCost <= 0) return { basisCost, basis, suggested: null, minimum: null, needsReview: false, reason: '' }

  const quote = quoteSalePriceFromCost({
    costPrice: basisCost,
    erpCategory: product.category,
    pricingCategoryId: product.pricingCategoryId,
    productType: product.productType,
    policy: settings.policy ?? undefined,
    legacyMarkupMap: settings.legacyMarkupMap ?? null,
  })
  let suggested: number | null = null
  let minimum: number | null = null
  if (quote.ok) {
    suggested = quote.max.sellExVatRounded
    minimum = quote.min.sellExVatRounded
  } else if ('legacySale' in quote && quote.legacySale != null) {
    suggested = quote.legacySale
    minimum = quote.legacySale
  }

  const costLabel = basis === 'latest' ? 'latest cost' : 'cost'
  if (sale < basisCost) {
    return { basisCost, basis, suggested, minimum, needsReview: true, reason: `Selling price is below the ${costLabel}` }
  }
  if (minimum != null && sale < minimum - 0.5) {
    return { basisCost, basis, suggested, minimum, needsReview: true, reason: `Selling price is below the margin band on the ${costLabel}` }
  }
  return { basisCost, basis, suggested, minimum, needsReview: false, reason: '' }
}
