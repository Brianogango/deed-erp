/**
 * Category markup → selling price from cost.
 * Formula: salePrice = round(costPrice × (1 + markupPct / 100))
 * Returns null when markup is unset so callers can leave sale price alone.
 */

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

/** Whole-KES selling price from cost and markup %. */
export function calcSalePriceFromCost(costPrice: number, markupPct: number): number {
  const cost = Number(costPrice)
  const pct = Number(markupPct)
  if (!Number.isFinite(cost) || cost < 0) return 0
  if (!Number.isFinite(pct)) return Math.round(cost)
  return Math.max(0, Math.round(cost * (1 + pct / 100)))
}

/** When markup is configured and cost is valid, return suggested sale; else null. */
export function suggestSalePriceFromCost(
  map: CategoryMarkupMap | null | undefined,
  category: string | null | undefined,
  costPrice: number | string | null | undefined,
): number | null {
  const pct = getCategoryMarkupPct(map, category)
  if (pct === null) return null
  if (costPrice === '' || costPrice === null || costPrice === undefined) return null
  const cost = Number(costPrice)
  if (!Number.isFinite(cost) || cost < 0) return null
  return calcSalePriceFromCost(cost, pct)
}
