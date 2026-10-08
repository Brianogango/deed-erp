import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'

/**
 * Quantity stock that the screen copy (deed_bulkStock, per location) and the
 * stock_levels table disagree on. The agreed rule: for items that are not
 * serial-tracked, both sides take the LOWER number. Serial-tracked items are
 * left alone — their count is the serials themselves.
 *
 * Where the copy is higher, the excess comes off its largest locations first;
 * where the table is higher, its on-hand count is lowered. A product with no
 * stock_levels row counts as 0 there.
 */

type Product = { id?: string; name?: string; costPrice?: number; cost?: number; trackingMethod?: string; category?: string; requiresSerial?: boolean; unit?: string }
type Level = { productId: string; location: string; qty: number }
type Serial = { productId?: string }

export type ReconcileRow = {
  productId: string
  product: string
  copyQty: number
  tableQty: number
  target: number
  /** Units taken off each copy location. */
  copyCuts: Array<{ location: string; qty: number }>
  /** Units taken off stock_levels. */
  tableCut: number
  unitCost: number
}

export function planQuantityReconcile(input: {
  products: Product[]
  bulkStock: Level[]
  serials: Serial[]
  tableQty: Map<string, number>
}): ReconcileRow[] {
  const byId = new Map(input.products.filter(p => p?.id).map(p => [String(p.id), p]))
  const serialised = new Set(input.serials.map(s => String(s?.productId ?? '')).filter(Boolean))
  const copy = new Map<string, Level[]>()
  for (const l of input.bulkStock) {
    if (!l?.productId) continue
    const list = copy.get(l.productId) ?? []
    list.push({ productId: l.productId, location: String(l.location || 'warehouse'), qty: Number(l.qty) || 0 })
    copy.set(l.productId, list)
  }

  const out: ReconcileRow[] = []
  // Only products the copy tracks quantities for (the rows the check
  // compared). A table row with no copy row is not treated as "screen 0":
  // that would empty stock the screens may count another way.
  for (const productId of copy.keys()) {
    const product = byId.get(productId)
    if (serialised.has(productId)) continue
    if (product && isSerialTracking(inferTrackingMethod(product))) continue
    const levels = copy.get(productId) ?? []
    const copyQty = levels.reduce((s, l) => s + Math.max(0, l.qty), 0)
    const tableQty = Math.max(0, input.tableQty.get(productId) ?? 0)
    if (copyQty === tableQty) continue
    const target = Math.min(copyQty, tableQty)

    const copyCuts: ReconcileRow['copyCuts'] = []
    let excess = copyQty - target
    for (const l of [...levels].sort((a, b) => b.qty - a.qty)) {
      if (excess <= 0) break
      const cut = Math.min(excess, Math.max(0, l.qty))
      if (cut > 0) copyCuts.push({ location: l.location, qty: cut })
      excess -= cut
    }
    out.push({
      productId,
      product: product?.name || productId,
      copyQty,
      tableQty,
      target,
      copyCuts,
      tableCut: tableQty - target,
      unitCost: Number(product?.costPrice) || Number(product?.cost) || 0,
    })
  }
  return out.sort((a, b) => Math.abs(b.copyQty - b.tableQty) - Math.abs(a.copyQty - a.tableQty))
}
