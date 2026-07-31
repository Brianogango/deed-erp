/**
 * Sales pricelist engine.
 *
 * Built-in lists map onto existing product price columns:
 *   RETAIL    → sellingPrice / salePrice
 *   WHOLESALE → wholesalePrice (falls back to retail)
 *   KILIMALL  → kilimallPrice (falls back to retail)
 *
 * Custom list items (fixed unit prices) override column sources when present.
 * Discount / special_pricing approvals reuse the existing approval ladders.
 */

import type { CurrencyCode } from '@/lib/currency'
import { FUNCTIONAL_CURRENCY, normalizeCurrencyCode } from '@/lib/currency'

export type PriceSource = 'selling_price' | 'wholesale_price' | 'kilimall_price' | 'fixed'

export type PricelistCode = 'RETAIL' | 'WHOLESALE' | 'KILIMALL' | string

export interface PriceListDef {
  id: string
  code: PricelistCode
  name: string
  currencyCode: CurrencyCode
  priceSource: PriceSource
  isActive: boolean
  sortOrder?: number
}

export interface PriceListItemDef {
  id: string
  priceListId: string
  productId: string
  unitPrice: number
  minimumQty: number
  maximumDiscount: number
  validFrom?: string
  validUntil?: string
  active: boolean
}

/** Product fields the resolver needs — works with client Product + Prisma row shapes. */
export interface PricelistProductPrices {
  id?: string
  salePrice?: number | null
  sellingPrice?: number | null
  wholesalePrice?: number | null
  kilimallPrice?: number | null
}

export const BUILTIN_PRICELISTS: PriceListDef[] = [
  {
    id: 'pl-retail',
    code: 'RETAIL',
    name: 'Retail',
    currencyCode: FUNCTIONAL_CURRENCY,
    priceSource: 'selling_price',
    isActive: true,
    sortOrder: 10,
  },
  {
    id: 'pl-wholesale',
    code: 'WHOLESALE',
    name: 'Wholesale',
    currencyCode: FUNCTIONAL_CURRENCY,
    priceSource: 'wholesale_price',
    isActive: true,
    sortOrder: 20,
  },
  {
    id: 'pl-kilimall',
    code: 'KILIMALL',
    name: 'Kilimall',
    currencyCode: FUNCTIONAL_CURRENCY,
    priceSource: 'kilimall_price',
    isActive: true,
    sortOrder: 30,
  },
]

export function normalizePricelistCode(value?: string | null): string {
  return String(value || 'RETAIL').trim().toUpperCase() || 'RETAIL'
}

export function findPriceList(
  lists: PriceListDef[],
  codeOrName?: string | null,
): PriceListDef | undefined {
  if (!codeOrName) return lists.find(l => l.code === 'RETAIL' && l.isActive) ?? lists[0]
  const needle = normalizePricelistCode(codeOrName)
  return (
    lists.find(l => normalizePricelistCode(l.code) === needle && l.isActive) ||
    lists.find(l => l.name.trim().toUpperCase() === needle && l.isActive) ||
    lists.find(l => l.id === codeOrName)
  )
}

function retailPrice(product: PricelistProductPrices): number {
  return Number(product.salePrice ?? product.sellingPrice ?? 0) || 0
}

function sourcePrice(product: PricelistProductPrices, source: PriceSource): number {
  if (source === 'wholesale_price') {
    const w = Number(product.wholesalePrice)
    return Number.isFinite(w) && w > 0 ? w : retailPrice(product)
  }
  if (source === 'kilimall_price') {
    const k = Number(product.kilimallPrice)
    return Number.isFinite(k) && k > 0 ? k : retailPrice(product)
  }
  return retailPrice(product)
}

export interface ResolveListPriceResult {
  listPrice: number
  unitPrice: number
  pricelistCode: string
  priceSource: PriceSource
  currencyCode: CurrencyCode
  /** True when unitPrice is below the list price (special pricing / discount path). */
  belowList: boolean
  discountFromListPercent: number
  usedItemOverride: boolean
}

function itemStillValid(item: PriceListItemDef, asOf: string): boolean {
  if (!item.active) return false
  const day = asOf.slice(0, 10)
  if (item.validFrom && item.validFrom.slice(0, 10) > day) return false
  if (item.validUntil && item.validUntil.slice(0, 10) < day) return false
  return true
}

/**
 * Resolve the list/unit price for a product under a pricelist.
 * `customPrice` wins when provided (manual override / special pricing).
 */
export function resolveListPrice(opts: {
  product: PricelistProductPrices
  pricelist?: string | null
  qty?: number
  customPrice?: number | null
  priceLists?: PriceListDef[]
  priceListItems?: PriceListItemDef[]
  asOf?: string
}): ResolveListPriceResult {
  const lists = opts.priceLists?.length ? opts.priceLists : BUILTIN_PRICELISTS
  const list = findPriceList(lists, opts.pricelist) ?? BUILTIN_PRICELISTS[0]
  const asOf = (opts.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const qty = Math.max(1, Number(opts.qty) || 1)

  let listPrice = sourcePrice(opts.product, list.priceSource === 'fixed' ? 'selling_price' : list.priceSource)
  let usedItemOverride = false

  const items = (opts.priceListItems || []).filter(
    i => i.priceListId === list.id && i.productId === opts.product.id && itemStillValid(i, asOf),
  )
  const qtyMatch = items
    .filter(i => qty >= (Number(i.minimumQty) || 1))
    .sort((a, b) => (Number(b.minimumQty) || 1) - (Number(a.minimumQty) || 1))[0]
  if (qtyMatch) {
    listPrice = Number(qtyMatch.unitPrice) || listPrice
    usedItemOverride = true
  } else if (list.priceSource === 'fixed' && items[0]) {
    listPrice = Number(items[0].unitPrice) || listPrice
    usedItemOverride = true
  }

  const custom = opts.customPrice
  const unitPrice =
    custom != null && Number.isFinite(Number(custom)) ? Number(custom) : listPrice

  const belowList = listPrice > 0 && unitPrice < listPrice - 0.005
  const discountFromListPercent =
    listPrice > 0 ? Math.round(((listPrice - unitPrice) / listPrice) * 10000) / 100 : 0

  return {
    listPrice,
    unitPrice,
    pricelistCode: String(list.code),
    priceSource: usedItemOverride ? 'fixed' : list.priceSource,
    currencyCode: normalizeCurrencyCode(list.currencyCode),
    belowList,
    discountFromListPercent,
    usedItemOverride,
  }
}

/** Whether a confirmed price needs special_pricing approval (below list, not just line discount %). */
export function needsSpecialPricingApproval(
  resolved: ResolveListPriceResult,
  lineDiscountPercent = 0,
): boolean {
  if (!resolved.belowList) return false
  // Line discount % already covered by discount approval ladder — special_pricing
  // fires when the unit price itself undercuts the list without a discount field.
  return lineDiscountPercent <= 0 && resolved.discountFromListPercent > 0
}

export function pricelistSelectOptions(lists: PriceListDef[] = BUILTIN_PRICELISTS) {
  return lists
    .filter(l => l.isActive)
    .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100))
    .map(l => ({ value: l.code, label: `${l.name} (${l.code})` }))
}
