/**
 * Shared dashboard / operations inventory KPI helpers.
 * One on-hand definition, one low-stock definition.
 */

import {
  isLowStockSku,
  onHandQtyAtStockLocations,
  type BulkStockLevel,
  type SerialNumber,
  type StockProduct,
} from '@/lib/business-logic'

export type LowStockItem<P extends StockProduct & { id: string; stockQty?: number }> = P & {
  onHand: number
}

export function computeLowStockItems<P extends StockProduct & { id: string }>(
  products: P[],
  serials: SerialNumber[],
  bulkStock: BulkStockLevel[],
): LowStockItem<P>[] {
  const items: LowStockItem<P>[] = []
  for (const product of products) {
    const onHand = onHandQtyAtStockLocations(product, serials, bulkStock, product.id)
    if (isLowStockSku(product, onHand)) items.push({ ...product, onHand })
  }
  return items
}

export function isStockOutMove(move: { type?: string } | null | undefined): boolean {
  const type = String(move?.type ?? '').toLowerCase()
  return type === 'out' || type === 'return'
}
