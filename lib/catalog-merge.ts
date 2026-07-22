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
  reorderLevel?: number | null
  isActive?: boolean
  category?: { name?: string | null } | null
}

const CATEGORY_EMOJI: Record<string, string> = {
  Laptops: '💻', Desktops: '🖥️', 'Mobile Devices': '📱', Accessories: '🖱️',
  Networking: '🌐', Printers: '🖨️', 'Software & Licences': '💿',
  'Parts & Components': '🔧', Services: '🛠️',
}

const normName = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function mergeCatalogProducts<P extends ClientCatalogProduct>(
  prev: P[],
  rows: CatalogApiRow[],
  categoryConfig: Record<string, { serialRequired: boolean }>,
): P[] {
  const prevById = new Map(prev.map(p => [p.id, p]))
  const prevByName = new Map(prev.map(p => [normName(p.name), p]))
  const merged = rows.map(row => {
    const local = prevById.get(String(row.id)) ?? prevByName.get(normName(row.name))
    const category = String(row.category?.name ?? local?.category ?? '')
    return {
      unit: 'pcs',
      image: CATEGORY_EMOJI[category] ?? '📦',
      taxRate: 16,
      stockQty: 0,
      canBeSold: true,
      canBePurchased: true,
      warrantyMonths: 6,
      requiresSerial: categoryConfig[category]?.serialRequired ?? false,
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
      minStock: Number(row.reorderLevel ?? local?.minStock ?? 1) || 0,
      isActive: row.isActive !== false,
    } as P
  })
  const ids = new Set(merged.map(p => p.id))
  const names = new Set(merged.map(p => normName(p.name)))
  for (const p of prev) {
    if (!ids.has(p.id) && !names.has(normName(p.name))) merged.push(p)
  }
  return merged
}
