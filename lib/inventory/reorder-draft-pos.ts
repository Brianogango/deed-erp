/**
 * Build draft purchase-order payloads from products at/under reorder level.
 */

export type ReorderProductLike = {
  id: string
  name: string
  sku?: string
  costPrice?: number
  taxRate?: number
  minStock?: number
  reorderLevel?: number
  reorderQty?: number | null
  requiresSerial?: boolean
  preferredVendorId?: string
  preferredVendorName?: string
}

export type ReorderStockLookup = (productId: string) => number

export type ReorderDraftLine = {
  productId: string
  productName: string
  qty: number
  unitPrice: number
  taxRate: number
  requiresSerial: boolean
  onHand: number
  reorderLevel: number
}

export type ReorderDraftPo = {
  vendorId: string
  vendorName: string
  notes: string
  lines: ReorderDraftLine[]
}

export function onHandFromLocations(locs: Partial<Record<string, number>> | null | undefined): number {
  if (!locs) return 0
  return Math.max(0,
    (Number(locs.warehouse) || 0) +
    (Number(locs.shop) || 0) +
    (Number(locs.repair_unit) || 0),
  )
}

export function reorderLevelOf(p: ReorderProductLike): number {
  return Math.max(0, Number(p.reorderLevel ?? p.minStock ?? 0) || 0)
}

export function qtyToReorder(p: ReorderProductLike, onHand: number): number {
  const level = reorderLevelOf(p)
  if (level <= 0 || onHand > level) return 0
  const deficit = Math.max(0, level - onHand)
  const configured = Math.max(0, Number(p.reorderQty) || 0)
  return Math.max(deficit, configured || level)
}

export function buildReorderDraftPos(
  products: ReorderProductLike[],
  getOnHand: ReorderStockLookup,
): ReorderDraftPo[] {
  const buckets = new Map<string, ReorderDraftPo>()

  for (const p of products) {
    const onHand = getOnHand(p.id)
    const qty = qtyToReorder(p, onHand)
    if (qty <= 0) continue
    const vendorId = p.preferredVendorId || ''
    const vendorName = p.preferredVendorName || (vendorId ? 'Vendor' : 'Assign vendor')
    const key = vendorId || '__unassigned__'
    if (!buckets.has(key)) {
      buckets.set(key, {
        vendorId,
        vendorName: vendorId ? vendorName : '',
        notes: 'Auto-created from low-stock reorder rules — review quantities and vendor before confirming',
        lines: [],
      })
    }
    buckets.get(key)!.lines.push({
      productId: p.id,
      productName: p.name,
      qty,
      unitPrice: Math.max(0, Number(p.costPrice) || 0),
      taxRate: Math.max(0, Number(p.taxRate) || 0),
      requiresSerial: !!p.requiresSerial,
      onHand,
      reorderLevel: reorderLevelOf(p),
    })
  }

  return [...buckets.values()].filter(po => po.lines.length > 0)
}
