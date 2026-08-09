/**
 * Server helper: sync product.costPrice (and optional sellingPrice from margin policy)
 * after valuation / cost changes.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { resolveListSaleFromMargin } from '@/lib/pricing/apply-margin-sale-price'
import { normalizePricingMarginPolicy } from '@/lib/pricing/margin-policy'

function asSpecs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export async function syncProductListFromCost(opts: {
  productId: string
  costPrice: number
  /** When false, only update costPrice (keep existing list). Default true. */
  recalcSale?: boolean
  /** When set, use this sale instead of margin suggestion. */
  salePrice?: number | null
}): Promise<{ costPrice: number; sellingPrice: number | null; saleRecalculated: boolean } | null> {
  const cost = Math.max(0, Number(opts.costPrice) || 0)
  const product = await prisma.product.findUnique({
    where: { id: opts.productId },
    select: {
      id: true,
      productType: true,
      specs: true,
      sellingPrice: true,
      category: { select: { name: true } },
    },
  })
  if (!product) return null

  const specs = asSpecs(product.specs)
  const data: { costPrice: number; sellingPrice?: number } = { costPrice: cost }
  let saleRecalculated = false

  if (opts.salePrice != null && Number.isFinite(Number(opts.salePrice))) {
    data.sellingPrice = Math.max(0, Number(opts.salePrice))
    saleRecalculated = true
  } else if (opts.recalcSale !== false) {
    let policy: unknown = null
    let legacy: unknown = null
    try {
      const state = await loadAppState(['deed_systemSettings'])
      const ss = state.deed_systemSettings as {
        pricingMarginPolicy?: unknown
        invCategorySaleMarkupPct?: Partial<Record<string, number>>
      } | null
      policy = ss?.pricingMarginPolicy
      legacy = ss?.invCategorySaleMarkupPct
    } catch { /* use defaults inside resolver */ }

    const resolved = resolveListSaleFromMargin({
      costPrice: cost,
      erpCategory: product.category?.name,
      pricingCategoryId: typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
      productType: product.productType,
      productKind: typeof specs.productKind === 'string' ? specs.productKind : null,
      unit: typeof specs.unit === 'string' ? specs.unit : null,
      policy: policy ? normalizePricingMarginPolicy(policy as any) : undefined,
      legacyMarkupMap: (legacy as Partial<Record<string, number>>) ?? null,
    })
    if (resolved.salePrice != null) {
      data.sellingPrice = resolved.salePrice
      saleRecalculated = true
    }
  }

  await prisma.product.update({ where: { id: opts.productId }, data })
  return {
    costPrice: cost,
    sellingPrice: data.sellingPrice ?? Number(product.sellingPrice) || null,
    saleRecalculated,
  }
}

/** Load system margin policy for server-side cost_plus / quote helpers. */
export async function loadServerMarginPolicy(): Promise<{
  policy: ReturnType<typeof normalizePricingMarginPolicy>
  legacyMarkupMap: Partial<Record<string, number>> | null
}> {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as {
      pricingMarginPolicy?: unknown
      invCategorySaleMarkupPct?: Partial<Record<string, number>>
    } | null
    return {
      policy: normalizePricingMarginPolicy(ss?.pricingMarginPolicy as any),
      legacyMarkupMap: ss?.invCategorySaleMarkupPct ?? null,
    }
  } catch {
    return {
      policy: normalizePricingMarginPolicy(null),
      legacyMarkupMap: null,
    }
  }
}
