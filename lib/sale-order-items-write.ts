import { optionalUuid } from '@/lib/legacy-compat'
import { calcSaleOrderLineMoney } from '@/lib/sales/line-calc'

export type SaleOrderItemRow = {
  id?: string
  productId?: string | null
  description: string
  qty: number
  qtyDelivered: number
  qtyInvoiced: number
  unitPrice: number
  taxRate: number
  discountPct: number
  lineTotal: number
  notes: string | null
  serialNumberId: string | null
  /**
   * Position in the document, taken from the client array index. This is the
   * only record of the user's ordering: the lines arrive as a positional JSON
   * array and the table is read back with an ORDER BY on this column.
   */
  sortOrder: number
}

/**
 * Map client lines onto Prisma SaleOrderItem create/update payloads while
 * preserving fulfillment qty and stable line ids when the client sends them.
 *
 * Section headings may exist as qty=0 rows (no product). They are written
 * deliberately so structure survives reload; readers restore `lineType`.
 */
export function isSaleOrderSectionLine(item: {
  lineType?: unknown
  qty?: unknown
  productId?: unknown
  unitPrice?: unknown
} | null | undefined) {
  if (!item) return false
  if (item.lineType === 'section') return true
  // Recover sections that were previously written without lineType
  // (qty 0, no product, no price) — do not treat zero-qty product rows as sections.
  return Number(item.qty ?? 0) === 0 && !item.productId && !(Number(item.unitPrice) > 0)
}

export function mapSaleOrderItems(lines: any[], existingItems: any[] = []): SaleOrderItemRow[] {
  const usedExisting = new Set<string>()
  return lines.map((item: any, index: number) => {
    let prev: any = null
    if (item.id) {
      prev = existingItems.find((row: any) => row.id === item.id) ?? null
      if (prev) usedExisting.add(prev.id)
    }
    if (!prev && item.productId) {
      prev =
        existingItems.find(
          (row: any) =>
            row.productId &&
            row.productId === item.productId &&
            !usedExisting.has(row.id),
        ) ?? null
      if (prev) usedExisting.add(prev.id)
    }
    // Section headings: keep a durable qty=0 row so order/structure survives reload.
    if (isSaleOrderSectionLine(item)) {
      return {
        id: prev?.id,
        productId: null,
        description: item.description ?? item.productName ?? 'Section',
        qty: 0,
        qtyDelivered: 0,
        qtyInvoiced: 0,
        unitPrice: 0,
        taxRate: 0,
        discountPct: 0,
        lineTotal: 0,
        notes: item.notes ?? null,
        serialNumberId: null,
        sortOrder: index,
      }
    }
    const demand = Math.max(0, Number(item.qty ?? 1) || 0)
    const incomingDelivered = Math.max(0, Number(item.qtyDelivered ?? 0) || 0)
    const incomingInvoiced = Math.max(0, Number(item.qtyInvoiced ?? 0) || 0)
    const qtyDelivered = Math.min(
      demand,
      Math.max(Number(prev?.qtyDelivered) || 0, incomingDelivered),
    )
    const qtyInvoiced = Math.min(
      demand,
      Math.max(Number(prev?.qtyInvoiced) || 0, incomingInvoiced),
    )
    // lineTotal is recomputed from qty × unitPrice × (1 − discount%) rather
    // than trusted from the client — a tampered or stale client-declared
    // lineTotal/subtotal must never reach the database (P0 totals-integrity).
    // Reuse the same `demand` qty computed above (defaults to 1 when omitted)
    // so the persisted qty and lineTotal never disagree on what "qty" meant.
    const money = calcSaleOrderLineMoney({ ...item, qty: demand })
    return {
      id: prev?.id,
      productId: optionalUuid(item.productId) ?? null,
      description: item.description ?? item.productName ?? 'Item',
      qty: demand,
      qtyDelivered,
      qtyInvoiced,
      unitPrice: money.unitPrice,
      taxRate: money.taxRate,
      discountPct: money.discountPct,
      lineTotal: money.lineTotal,
      notes: item.notes ?? null,
      serialNumberId: optionalUuid(
        item.serialNumberId ?? item.serialIds?.[0] ?? prev?.serialNumberId,
      ) ?? null,
      sortOrder: index,
    }
  })
}

/**
 * Build a Prisma nested write that upserts by id instead of deleteMany+create.
 * Prevents line UUID churn that breaks chatter / serial / fulfillment links.
 *
 * Every row carries sortOrder in its `data`, including the update branch. That
 * matters: a reorder changes no other field, so before sortOrder existed the
 * update list was a set of no-ops and the reorder never reached the database.
 */
export function buildSaleOrderItemsNestedWrite(lines: any[], existingItems: any[] = []) {
  const mapped = mapSaleOrderItems(lines, existingItems)
  const keepIds = new Set(mapped.map(m => m.id).filter(Boolean) as string[])
  const deleteIds = existingItems
    .filter((row: any) => row?.id && !keepIds.has(row.id))
    .map((row: any) => row.id as string)

  const create: Omit<SaleOrderItemRow, 'id'>[] = []
  const update: Array<{ where: { id: string }; data: Omit<SaleOrderItemRow, 'id'> }> = []

  for (const row of mapped) {
    const { id, ...data } = row
    if (id && keepIds.has(id) && existingItems.some((e: any) => e.id === id)) {
      update.push({ where: { id }, data })
    } else {
      create.push(data)
    }
  }

  return {
    deleteMany: deleteIds.length > 0 ? { id: { in: deleteIds } } : undefined,
    update: update.length > 0 ? update : undefined,
    create: create.length > 0 ? create : undefined,
  }
}
