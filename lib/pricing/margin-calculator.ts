/**
 * Margin calculator from cost — foolproof port of the Deed Margins spreadsheet.
 *
 * Formula (Calculator sheet):
 *   overheadRate = annualOverhead / annualRevenue
 *   tierReduction = approximate VLOOKUP(buyCost, tiers)
 *   effectiveMargin = categoryTargetMargin - tierReduction
 *   pricingDivisor = 1 - overheadRate - effectiveMargin
 *   sellExVat = buyCost / pricingDivisor
 *   invoiceIncVat = sellExVat * (1 + vatRate)
 *   recommended list = roundUp(sellExVat, roundUpKes)
 */

import {
  type PricingMarginCategory,
  type PricingMarginPolicy,
  type PricingTier,
  overheadRateFromPolicy,
  resolvePricingCategoryId,
} from '@/lib/pricing/margin-policy'

const DIVISOR_EPS = 1e-9

export function roundUpKes(amount: number, step = 500): number {
  const n = Number(amount)
  const s = Number(step)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (!Number.isFinite(s) || s <= 0) return Math.ceil(n)
  return Math.ceil(n / s) * s
}

/** Approximate VLOOKUP: largest tier with priceFromKes <= buyCost. */
export function lookupTierReduction(
  buyCostKes: number,
  tiers: readonly PricingTier[],
): { reductionPct: number; tier: PricingTier | null } {
  const cost = Number(buyCostKes)
  if (!Number.isFinite(cost) || !tiers.length) return { reductionPct: 0, tier: null }
  let best: PricingTier | null = null
  for (const t of tiers) {
    if (t.priceFromKes <= cost && (!best || t.priceFromKes >= best.priceFromKes)) {
      best = t
    }
  }
  return { reductionPct: best ? Number(best.reductionPct) || 0 : 0, tier: best }
}

export interface MarginQuoteBand {
  targetMarginPct: number
  effectiveMarginPct: number
  pricingDivisor: number
  sellExVat: number
  sellExVatRounded: number
  invoiceIncVat: number
  invoiceIncVatRounded: number
}

export interface MarginQuoteResult {
  ok: true
  buyCostKes: number
  overheadRatePct: number
  tierReductionPct: number
  tierLabel: string | null
  category: PricingMarginCategory
  vatRatePct: number
  roundUpKes: number
  /** Lower selling price band (min target profit after overhead). */
  min: MarginQuoteBand
  /** Higher selling price band (max target profit after overhead). */
  max: MarginQuoteBand
  /**
   * Classic gross margin floor on selling price for approval:
   * overheadRate + effectiveMinTarget (may be below overhead when tier reduction is large).
   */
  approvalMinGrossMarginPct: number
}

export interface MarginQuoteError {
  ok: false
  error: string
}

export type MarginQuote = MarginQuoteResult | MarginQuoteError

function bandFrom(
  buyCost: number,
  overheadRate: number,
  tierReductionPct: number,
  targetMarginPct: number,
  vatRatePct: number,
  roundStep: number,
): MarginQuoteBand | { error: string } {
  const effectiveMarginPct = targetMarginPct - tierReductionPct
  const pricingDivisor = 1 - overheadRate - effectiveMarginPct / 100
  if (!(pricingDivisor > DIVISOR_EPS)) {
    return {
      error: `Pricing divisor is not positive (overhead ${pctLabel(overheadRate * 100)} + effective margin ${pctLabel(effectiveMarginPct)} >= 100%). Raise sell band or lower overhead/targets.`,
    }
  }
  const sellExVat = buyCost / pricingDivisor
  const sellExVatRounded = roundUpKes(sellExVat, roundStep)
  const vatMul = 1 + vatRatePct / 100
  return {
    targetMarginPct,
    effectiveMarginPct,
    pricingDivisor,
    sellExVat,
    sellExVatRounded,
    invoiceIncVat: sellExVat * vatMul,
    invoiceIncVatRounded: roundUpKes(sellExVat * vatMul, roundStep),
  }
}

function pctLabel(n: number): string {
  return `${(Math.round(n * 100) / 100).toFixed(2)}%`
}

export function calculateMarginQuote(opts: {
  policy: PricingMarginPolicy
  buyCostKes: number
  pricingCategoryId?: string | null
  erpCategory?: string | null
  productType?: 'new' | 'refurbished' | string | null
}): MarginQuote {
  const policy = opts.policy
  if (!policy.enabled) return { ok: false, error: 'Margin pricing policy is disabled' }

  const buyCost = Number(opts.buyCostKes)
  if (!Number.isFinite(buyCost) || buyCost < 0) {
    return { ok: false, error: 'Buy cost must be a non-negative number' }
  }
  if (buyCost === 0) {
    return { ok: false, error: 'Buy cost is zero - set cost before pricing' }
  }

  const categoryId = resolvePricingCategoryId({
    policy,
    erpCategory: opts.erpCategory,
    pricingCategoryId: opts.pricingCategoryId,
    productType: opts.productType,
  })
  if (!categoryId) {
    return { ok: false, error: 'No pricing category mapped for this product' }
  }
  const category = policy.categories.find(c => c.id === categoryId)
  if (!category) {
    return { ok: false, error: `Pricing category "${categoryId}" not found in policy` }
  }

  const overheadRate = overheadRateFromPolicy(policy)
  if (!(overheadRate >= 0) || overheadRate >= 1) {
    return { ok: false, error: 'Overhead rate must be between 0% and 100%' }
  }

  const { reductionPct, tier } = lookupTierReduction(buyCost, policy.tiers)
  const vatRatePct = Number(policy.vatRatePct) || 0
  const roundStep = Math.max(1, Number(policy.roundUpKes) || 500)

  const minBand = bandFrom(buyCost, overheadRate, reductionPct, category.minGpMarginPct, vatRatePct, roundStep)
  if ('error' in minBand) return { ok: false, error: minBand.error }
  const maxBand = bandFrom(buyCost, overheadRate, reductionPct, category.maxGpMarginPct, vatRatePct, roundStep)
  if ('error' in maxBand) return { ok: false, error: maxBand.error }

  // Classic GP% on sell = overhead + effective target (spreadsheet identity).
  const approvalMinGrossMarginPct = overheadRate * 100 + minBand.effectiveMarginPct

  return {
    ok: true,
    buyCostKes: buyCost,
    overheadRatePct: overheadRate * 100,
    tierReductionPct: reductionPct,
    tierLabel: tier?.label ?? null,
    category,
    vatRatePct,
    roundUpKes: roundStep,
    min: minBand,
    max: maxBand,
    approvalMinGrossMarginPct,
  }
}

/** Default list/retail suggestion = rounded max band (quote down toward min). */
export function suggestedListPriceFromQuote(quote: MarginQuote): number | null {
  if (!quote.ok) return null
  return quote.max.sellExVatRounded
}

export function classicGrossMarginPct(sellExVat: number, costKes: number): number | null {
  const sell = Number(sellExVat)
  const cost = Number(costKes)
  if (!Number.isFinite(sell) || sell <= 0) return null
  if (!Number.isFinite(cost)) return null
  return ((sell - cost) / sell) * 100
}
