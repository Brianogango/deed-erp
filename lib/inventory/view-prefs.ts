/**
 * Display choices for the Inventory screens (Catalog, Product Master, Warehouse):
 * which products show, which condition, how they are ordered and which columns
 * a layout preset turns on. Pure logic — storage lives in use-inventory-view.
 */

export type CatalogShow = 'in_stock' | 'out_of_stock' | 'all_sellable'
export type ConditionFilter = 'all' | 'new' | 'refurbished'
export type CatalogSort = 'name' | 'price_asc' | 'price_desc' | 'stock_desc' | 'updated'
export type WarehouseSort = 'units' | 'name'

export const CATALOG_SHOW_OPTIONS: Array<{ value: CatalogShow; label: string; hint: string }> = [
  { value: 'in_stock', label: 'In stock', hint: 'Ready to sell now (default)' },
  { value: 'out_of_stock', label: 'Out of stock', hint: 'Sellable products with nothing on the shelf' },
  { value: 'all_sellable', label: 'All sellable', hint: 'Every active product that can be sold, stock or not' },
]

export const CONDITION_OPTIONS: Array<{ value: ConditionFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'refurbished', label: 'Refurbished' },
]

export const CATALOG_SORT_OPTIONS: Array<{ value: CatalogSort; label: string }> = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'stock_desc', label: 'Most stock' },
  { value: 'updated', label: 'Recently updated' },
]

export const WAREHOUSE_SORT_OPTIONS: Array<{ value: WarehouseSort; label: string }> = [
  { value: 'units', label: 'Most units' },
  { value: 'name', label: 'Name A–Z' },
]

export interface LayoutPreset {
  id: string
  label: string
  hint: string
  /** Column keys switched on. Required (priority 1) columns always stay. */
  columns: string[]
}

/** Catalog columns: product, category, condition, available, cost, latestCost, salePrice, margin, lastUpdate. */
export const CATALOG_LAYOUTS: LayoutPreset[] = [
  {
    id: 'sales',
    label: 'Sales',
    hint: 'Product, condition, available and price',
    columns: ['product', 'category', 'condition', 'available', 'salePrice'],
  },
  {
    id: 'pricing',
    label: 'Pricing',
    hint: 'Adds cost, latest cost, GP % and last update',
    columns: ['product', 'category', 'condition', 'available', 'cost', 'latestCost', 'salePrice', 'margin', 'lastUpdate'],
  },
]

/**
 * Product Master is about what a product IS (type, tracking, reorder rule) —
 * prices live in Catalog and unit-by-unit stock in Warehouse, so neither is
 * repeated here. Available and Warehouse stay in the column picker, off by default.
 */
export const PRODUCT_LAYOUTS: LayoutPreset[] = [
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Product, condition, type, tracking, on hand, held and reorder rule',
    columns: ['product', 'category', 'condition', 'type', 'tracking', 'onHand', 'held', 'reorder'],
  },
  {
    id: 'setup',
    label: 'Setup',
    hint: 'How each product is set up: type and tracking',
    columns: ['product', 'category', 'condition', 'type', 'tracking', 'onHand'],
  },
  {
    id: 'reorder',
    label: 'Reorder',
    hint: 'On hand against the reorder level',
    columns: ['product', 'category', 'onHand', 'held', 'reorder'],
  },
]

export interface ProductLike {
  productType?: string | null
  isActive?: boolean
  canBeSold?: boolean
  salePrice?: number
  category?: string
}

export function conditionOf(product: Pick<ProductLike, 'productType'>): 'new' | 'refurbished' {
  return product.productType === 'new' ? 'new' : 'refurbished'
}

export function matchesCondition(product: Pick<ProductLike, 'productType'>, condition: ConditionFilter): boolean {
  return condition === 'all' || conditionOf(product) === condition
}

/**
 * Whether a product belongs in the catalog for the chosen "Show" option.
 * `sellableQty` is the quantity free to sell right now; `tracksStock` is false
 * for services, which never have a shelf quantity.
 */
export function matchesCatalogShow(
  product: ProductLike,
  show: CatalogShow,
  sellableQty: number,
  tracksStock: boolean,
): boolean {
  if (product.isActive === false || product.canBeSold === false) return false
  if (show === 'in_stock') return sellableQty >= 1
  if (show === 'out_of_stock') return tracksStock && sellableQty < 1
  return true
}

export interface CatalogSortInput {
  name: string
  salePrice: number
  qty: number
  /** ISO date of the latest price change; empty when it never changed. */
  updatedAt: string
}

export function compareCatalog(sort: CatalogSort): (a: CatalogSortInput, b: CatalogSortInput) => number {
  const byName = (a: CatalogSortInput, b: CatalogSortInput) => a.name.localeCompare(b.name)
  switch (sort) {
    case 'price_asc':
      return (a, b) => (Number(a.salePrice) || 0) - (Number(b.salePrice) || 0) || byName(a, b)
    case 'price_desc':
      return (a, b) => (Number(b.salePrice) || 0) - (Number(a.salePrice) || 0) || byName(a, b)
    case 'stock_desc':
      return (a, b) => b.qty - a.qty || byName(a, b)
    case 'updated':
      return (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || byName(a, b)
    default:
      return byName
  }
}

export interface InventoryViewPrefs {
  condition: ConditionFilter
  catalogShow: CatalogShow
  catalogSort: CatalogSort
  catalogLayout: string
  productsLayout: string
  warehouseSort: WarehouseSort
}

export const DEFAULT_VIEW_PREFS: InventoryViewPrefs = {
  condition: 'all',
  catalogShow: 'in_stock',
  catalogSort: 'name',
  catalogLayout: 'pricing',
  productsLayout: 'standard',
  warehouseSort: 'units',
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Reads a stored blob defensively — unknown or stale values fall back to the defaults. */
export function normalizeViewPrefs(raw: unknown): InventoryViewPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    condition: pick(o.condition, CONDITION_OPTIONS.map(x => x.value), DEFAULT_VIEW_PREFS.condition),
    catalogShow: pick(o.catalogShow, CATALOG_SHOW_OPTIONS.map(x => x.value), DEFAULT_VIEW_PREFS.catalogShow),
    catalogSort: pick(o.catalogSort, CATALOG_SORT_OPTIONS.map(x => x.value), DEFAULT_VIEW_PREFS.catalogSort),
    catalogLayout: pick(o.catalogLayout, CATALOG_LAYOUTS.map(x => x.id), DEFAULT_VIEW_PREFS.catalogLayout),
    productsLayout: pick(o.productsLayout, PRODUCT_LAYOUTS.map(x => x.id), DEFAULT_VIEW_PREFS.productsLayout),
    warehouseSort: pick(o.warehouseSort, WAREHOUSE_SORT_OPTIONS.map(x => x.value), DEFAULT_VIEW_PREFS.warehouseSort),
  }
}
