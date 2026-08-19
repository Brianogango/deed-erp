import { isSerialOnlyCategory, inferTrackingMethod } from '@/lib/inventory-identifiers'
import { deviceConfigFromProductSpecs } from '@/lib/reconfiguration/unit-config'

// Merge the relational product catalog (GET /api/products rows) into the
// client-side product list kept in the synced JSON store.
//
// The catalog is the source of truth for identity and commercial fields
// (id/sku/name/description/category/prices/min stock/active). Client-only
// fields (image, tax rate, warranty, stock display, account codes, tracking)
// come from the existing store entry when one exists, or category-based
// defaults when the row is new to the client. Store-only items (legacy rows
// that old invoices or repairs may still reference) are kept at the end.

export interface ClientCatalogProduct {
  id: string
  sku: string
  barcode: string
  name: string
  description: string
  category: string
  salePrice: number
  costPrice: number
  minStock: number
  isActive: boolean
  unit: string
  image: string
  taxRate: number
  stockQty: number
  canBeSold: boolean
  canBePurchased: boolean
  warrantyMonths: number
  requiresSerial: boolean
  saleAccountCode?: string
  costAccountCode?: string
  [key: string]: unknown
}

export interface CatalogApiRow {
  id: string
  sku?: string | null
  barcode?: string | null
  name?: string | null
  description?: string | null
  sellingPrice?: number | string | null
  costPrice?: number | string | null
  wholesalePrice?: number | string | null
  kilimallPrice?: number | string | null
  reorderLevel?: number | null
  isActive?: boolean
  trackingMethod?: 'NONE' | 'QUANTITY' | 'BATCH' | 'SERIAL' | string | null
  invoicePolicy?: 'order' | 'delivery' | string | null
  productType?: 'new' | 'refurbished' | string | null
  specs?: {
    productKind?: string | null
    unit?: string | null
    taxRatePct?: number | string | null
    pricingCategoryId?: string | null
    [key: string]: unknown
  } | null
  category?: { name?: string | null } | null
}

const CATEGORY_EMOJI: Record<string, string> = {
  Laptops: '💻', Desktops: '🖥️', 'Mobile Devices': '📱', Accessories: '🖱️',
  Networking: '🌐', Printers: '🖨️', 'Software & Licences': '💿',
  'Parts & Components': '🔧', Services: '🛠️',
}

const normName = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function identityKeys(row: { name?: unknown; sku?: unknown; barcode?: unknown; parentId?: unknown }) {
  const name = normName(row.name)
  const sku = normName(row.sku)
  const barcode = normName(row.barcode)
  const parent = String(row.parentId ?? '').trim()
  const keys: string[] = []
  if (sku) keys.push(`sku:${sku}`)
  if (barcode) keys.push(`bc:${barcode}`)
  if (name && !parent) keys.push(`name:${name}`)
  if (name && parent) keys.push(`var:${parent}:${name}`)
  return keys
}

/**
 * Drop extra rows that share name/SKU/barcode (optimistic UUID + Prisma UUID).
 * First occurrence wins — callers should put the preferred list first.
 */
export function collapseProductIdentityDuplicates<T extends {
  id?: string
  name?: unknown
  sku?: unknown
  barcode?: unknown
  parentId?: unknown
}>(rows: T[]): T[] {
  const kept: T[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const keys = identityKeys(row)
    if (keys.some(key => seen.has(key))) continue
    for (const key of keys) seen.add(key)
    kept.push(row)
  }
  return kept
}

/** Union store writes so a stale shorter list cannot drop catalog products. */
export function mergeProductsStoreWrite(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(incoming)) return current
  if (!Array.isArray(current) || current.length === 0) return incoming
  const currentById = new Map<string, any>()
  for (const row of current) {
    if (row && typeof row === 'object' && (row as any).id) currentById.set(String((row as any).id), row)
  }
  const incomingById = new Map<string, any>()
  for (const row of incoming) {
    if (row && typeof row === 'object' && (row as any).id) incomingById.set(String((row as any).id), row)
  }
  const seen = new Set<string>()
  const merged: any[] = []
  // Keep the client's existing order so SSE stock/catalog sync does not reshuffle
  // the product catalogue while the user is searching or paging.
  for (const row of current) {
    if (!row || typeof row !== 'object' || !(row as any).id) continue
    const id = String((row as any).id)
    const incomingRow = incomingById.get(id)
    seen.add(id)
    merged.push(incomingRow ? { ...(row as any), ...incomingRow } : row)
  }
  for (const row of incoming) {
    if (!row || typeof row !== 'object' || !(row as any).id) continue
    const id = String((row as any).id)
    if (seen.has(id)) continue
    seen.add(id)
    merged.push({ ...(currentById.get(id) ?? {}), ...(row as any) })
  }
  // Optimistic create uses a client UUID, then Prisma returns another UUID for
  // the same name/SKU. Blob/SSE union-by-id would otherwise keep both rows.
  return collapseProductIdentityDuplicates(merged)
}

/**
 * Apply an SSE / cross-tab products payload without dropping catalog rows or
 * reshuffling the list. Returns the previous array reference when unchanged so
 * React skips catalogue re-renders (search flicker).
 */
export function mergeProductsRemoteState<P extends { id?: string }>(local: P[], remote: P[]): P[] {
  const merged = mergeProductsStoreWrite(local, remote) as P[]
  if (!Array.isArray(merged)) return local
  return JSON.stringify(merged) === JSON.stringify(local) ? local : merged
}

function preserveClientProductOrder<P extends { id: string }>(prev: P[], merged: P[]): P[] {
  if (prev.length === 0) return merged
  const byId = new Map(merged.map(p => [p.id, p]))
  const ordered: P[] = []
  const seen = new Set<string>()
  for (const p of prev) {
    const next = byId.get(p.id)
    if (!next) continue
    ordered.push(next)
    seen.add(p.id)
  }
  for (const p of merged) {
    if (!seen.has(p.id)) ordered.push(p)
  }
  return ordered
}

export function mergeCatalogProducts<P extends ClientCatalogProduct>(
  prev: P[],
  rows: CatalogApiRow[],
  categoryConfig: Record<string, { serialRequired: boolean }>,
  opts?: { preserveClientOrder?: boolean },
): P[] {
  const prevById = new Map(prev.map(p => [p.id, p]))
  const prevByName = new Map(prev.map(p => [normName(p.name), p]))
  const merged = rows.map(row => {
    const local = prevById.get(String(row.id)) ?? prevByName.get(normName(row.name))
    const category = String(row.category?.name ?? local?.category ?? '')
    const trackingMethod = inferTrackingMethod({
      trackingMethod: row.trackingMethod || (local as any)?.trackingMethod,
      category,
      requiresSerial: categoryConfig[category]?.serialRequired,
      unit: local?.unit,
    })
    const specs = row.specs && typeof row.specs === 'object' ? row.specs : null
    const productType =
      row.productType === 'new' || row.productType === 'refurbished'
        ? row.productType
        : ((local as any)?.productType === 'new' ? 'new' : (local as any)?.productType === 'refurbished' ? 'refurbished' : 'refurbished')
    const pricingCategoryId =
      typeof specs?.pricingCategoryId === 'string' && specs.pricingCategoryId
        ? specs.pricingCategoryId
        : (local as any)?.pricingCategoryId || undefined
    const productKind =
      typeof specs?.productKind === 'string' && specs.productKind
        ? specs.productKind
        : (local as any)?.productKind
    const unitFromSpecs = typeof specs?.unit === 'string' && specs.unit ? specs.unit : null
    const taxFromSpecs = specs?.taxRatePct != null ? Number(specs.taxRatePct) : NaN
    return {
      image: CATEGORY_EMOJI[category] ?? '📦',
      stockQty: 0,
      canBeSold: true,
      canBePurchased: true,
      warrantyMonths: 6,
      saleAccountCode: '5001',
      costAccountCode: '6101',
      ...(local ?? {}),
      id: String(row.id),
      sku: String(row.sku ?? local?.sku ?? ''),
      barcode: String(row.barcode ?? local?.barcode ?? ''),
      name: String(row.name ?? local?.name ?? ''),
      description: String(row.description ?? local?.description ?? ''),
      category,
      salePrice: Number(row.sellingPrice ?? local?.salePrice ?? 0) || 0,
      costPrice: Number(row.costPrice ?? local?.costPrice ?? 0) || 0,
      wholesalePrice: row.wholesalePrice != null
        ? Number(row.wholesalePrice) || 0
        : (local as any)?.wholesalePrice,
      kilimallPrice: row.kilimallPrice != null
        ? Number(row.kilimallPrice) || 0
        : (local as any)?.kilimallPrice,
      minStock: Number(row.reorderLevel ?? local?.minStock ?? 1) || 0,
      trackingMethod,
      requiresSerial: trackingMethod === 'SERIAL' || isSerialOnlyCategory(category),
      productType,
      pricingCategoryId,
      productKind: productKind || (local as any)?.productKind,
      unit: unitFromSpecs || local?.unit || 'pcs',
      taxRate: Number.isFinite(taxFromSpecs) ? taxFromSpecs : (local?.taxRate ?? 16),
      deviceConfig: deviceConfigFromProductSpecs(specs) || (local as any)?.deviceConfig || null,
      // Odoo invoicing policy — server value wins, defaults to Ordered Quantities.
      invoicePolicy: (row.invoicePolicy === 'delivery' || (local as any)?.invoicePolicy === 'delivery') ? 'delivery' : 'order',
      isActive: row.isActive !== false,
    } as unknown as P
  })
  const catalogKeys = new Set(merged.flatMap(p => identityKeys(p)))
  const ids = new Set(merged.map(p => p.id))
  for (const p of prev) {
    if (ids.has(p.id)) continue
    if (identityKeys(p).some(key => catalogKeys.has(key))) continue
    merged.push(p)
  }
  const ordered = opts?.preserveClientOrder ? preserveClientProductOrder(prev, merged) : merged
  return collapseProductIdentityDuplicates(ordered)
}
