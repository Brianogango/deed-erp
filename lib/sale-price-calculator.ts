/**
 * Sale price from cost.
 *
 * Primary engine: Deed margin calculator (overhead + category GP + tier reduction).
 * Legacy fallback: category markup % → sale = round(cost × (1 + pct/100)).
 */

import {
  calculateMarginQuote,
  suggestedListPriceFromQuote,
  suggestedWholesalePriceFromQuote,
  type MarginQuote,
} from '@/lib/pricing/margin-calculator'
import {
  DEFAULT_PRICING_MARGIN_POLICY,
  normalizePricingMarginPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'

export type CategoryMarkupMap = Partial<Record<string, number>>

export function getCategoryMarkupPct(
  map: CategoryMarkupMap | null | undefined,
  category: string | null | undefined,
): number | null {
  if (!map || !category) return null
  const raw = map[category]
  if (raw === undefined || raw === null || raw === ('' as unknown)) return null
  const pct = Number(raw)
  if (!Number.isFinite(pct)) return null
  return pct
}

/** Whole-KES selling price from cost and markup % (legacy). */
export function calcSalePriceFromCost(costPrice: number, markupPct: number): number {
  const cost = Number(costPrice)
  const pct = Number(markupPct)
  if (!Number.isFinite(cost) || cost < 0) return 0
  if (!Number.isFinite(pct)) return Math.round(cost)
  return Math.max(0, Math.round(cost * (1 + pct / 100)))
}

export function quoteSalePriceFromCost(opts: {
  costPrice: number | string | null | undefined
  erpCategory?: string | null
  pricingCategoryId?: string | null
  productType?: 'new' | 'refurbished' | string | null
  policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
  /** Legacy markup map used only when policy is disabled or category unmapped. */
  legacyMarkupMap?: CategoryMarkupMap | null
}): MarginQuote | { ok: false; error: string; legacySale?: number | null } {
  const costRaw = opts.costPrice
  if (costRaw === '' || costRaw === null || costRaw === undefined) {
    return { ok: false, error: 'Cost is empty' }
  }
  const cost = Number(costRaw)
  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: 'Cost is invalid' }
  }

  const policy = normalizePricingMarginPolicy(opts.policy ?? DEFAULT_PRICING_MARGIN_POLICY)
  if (policy.enabled) {
    const quote = calculateMarginQuote({
      policy,
      buyCostKes: cost,
      erpCategory: opts.erpCategory,
      pricingCategoryId: opts.pricingCategoryId,
      productType: opts.productType,
    })
    if (quote.ok) return quote
    // Fall through to legacy markup when category is unmapped.
    if (!/no pricing category mapped/i.test(quote.error)) {
      return quote
    }
  }

  const pct = getCategoryMarkupPct(opts.legacyMarkupMap, opts.erpCategory)
  if (pct === null) {
    return { ok: false, error: 'No margin policy mapping or legacy markup for this category' }
  }
  return {
    ok: false,
    error: 'Using legacy markup',
    legacySale: calcSalePriceFromCost(cost, pct),
  }
}

/**
 * Suggested retail/list sale price from cost.
 * Prefers rounded max band from margin policy; else legacy markup.
 */
export function suggestSalePriceFromCost(
  mapOrPolicy: CategoryMarkupMap | PricingMarginPolicy | null | undefined,
  category: string | null | undefined,
  costPrice: number | string | null | undefined,
  opts?: {
    policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
    pricingCategoryId?: string | null
    productType?: 'new' | 'refurbished' | string | null
    legacyMarkupMap?: CategoryMarkupMap | null
  },
): number | null {
  // Back-compat: older callers pass (markupMap, category, cost).
  const looksLikePolicy =
    mapOrPolicy != null &&
    typeof mapOrPolicy === 'object' &&
    ('categories' in mapOrPolicy || 'annualOverheadKes' in mapOrPolicy || 'enabled' in mapOrPolicy)

  const policy = opts?.policy ?? (looksLikePolicy ? (mapOrPolicy as PricingMarginPolicy) : null)
  const legacy =
    opts?.legacyMarkupMap ??
    (!looksLikePolicy ? (mapOrPolicy as CategoryMarkupMap | null | undefined) : undefined)

  // Legacy 3-arg callers (markup map only) keep markup behaviour.
  // Inventory / Settings pass policy explicitly once margin calculator is live.
  if (!policy) {
    const pct = getCategoryMarkupPct(legacy, category)
    if (pct === null) return null
    if (costPrice === '' || costPrice === null || costPrice === undefined) return null
    const cost = Number(costPrice)
    if (!Number.isFinite(cost) || cost < 0) return null
    return calcSalePriceFromCost(cost, pct)
  }

  const result = quoteSalePriceFromCost({
    costPrice,
    erpCategory: category,
    pricingCategoryId: opts?.pricingCategoryId,
    productType: opts?.productType,
    policy,
    legacyMarkupMap: legacy,
  })

  if (result.ok) return suggestedListPriceFromQuote(result)
  if ('legacySale' in result && result.legacySale != null) return result.legacySale
  return null
}

/**
 * Suggested wholesale / reseller price from cost.
 * Uses the rounded min GP band only — never legacy markup or retail fallback.
 */
export function suggestWholesalePriceFromCost(
  mapOrPolicy: CategoryMarkupMap | PricingMarginPolicy | null | undefined,
  category: string | null | undefined,
  costPrice: number | string | null | undefined,
  opts?: {
    policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
    pricingCategoryId?: string | null
    productType?: 'new' | 'refurbished' | string | null
    legacyMarkupMap?: CategoryMarkupMap | null
  },
): number | null {
  const looksLikePolicy =
    mapOrPolicy != null &&
    typeof mapOrPolicy === 'object' &&
    ('categories' in mapOrPolicy || 'annualOverheadKes' in mapOrPolicy || 'enabled' in mapOrPolicy)

  const policy = opts?.policy ?? (looksLikePolicy ? (mapOrPolicy as PricingMarginPolicy) : null)
  if (!policy) return null

  const result = quoteSalePriceFromCost({
    costPrice,
    erpCategory: category,
    pricingCategoryId: opts?.pricingCategoryId,
    productType: opts?.productType,
    policy,
    legacyMarkupMap: opts?.legacyMarkupMap,
  })
  if (result.ok) return suggestedWholesalePriceFromQuote(result)
  return null
}

/**
 * Always returns a whole-KES list price when cost is valid.
 * Uses margin policy / markup when available; otherwise a conservative
 * ~30% gross-margin fallback so product forms and quote lines never sit at 0.
 */
export function autoSalePriceFromCost(
  mapOrPolicy: CategoryMarkupMap | PricingMarginPolicy | null | undefined,
  category: string | null | undefined,
  costPrice: number | string | null | undefined,
  opts?: {
    policy?: PricingMarginPolicy | Partial<PricingMarginPolicy> | null
    pricingCategoryId?: string | null
    productType?: 'new' | 'refurbished' | string | null
    legacyMarkupMap?: CategoryMarkupMap | null
  },
): number | null {
  const suggested = suggestSalePriceFromCost(mapOrPolicy, category, costPrice, opts)
  if (suggested != null && suggested > 0) return suggested
  if (costPrice === '' || costPrice === null || costPrice === undefined) return null
  const cost = Number(costPrice)
  if (!Number.isFinite(cost) || cost < 0) return null
  if (cost === 0) return 0
  // Fallback: sell ≈ cost / 0.70 → ~30% classic GP when no band/markup applies.
  return Math.max(0, Math.round(cost / 0.7))
}

export function suggestSalePriceFromMarginPolicy(
  policy: PricingMarginPolicy | Partial<PricingMarginPolicy> | null | undefined,
  opts: {
    costPrice: number | string | null | undefined
    erpCategory?: string | null
    pricingCategoryId?: string | null
    productType?: 'new' | 'refurbished' | string | null
    legacyMarkupMap?: CategoryMarkupMap | null
  },
): number | null {
  return suggestSalePriceFromCost(opts.legacyMarkupMap ?? null, opts.erpCategory, opts.costPrice, {
    policy,
    pricingCategoryId: opts.pricingCategoryId,
    productType: opts.productType,
    legacyMarkupMap: opts.legacyMarkupMap,
  })
}
