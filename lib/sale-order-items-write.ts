import { optionalUuid } from '@/lib/legacy-compat'

export type SaleOrderItemRow = {
  id?: string
  productId?: string | null
  description: string
  qty: number
  qtyDelivered: number
  qtyInvoiced: number
  unitPrice: number
  taxRate: number
  lineTotal: number
  notes: string | null
  serialNumberId: string | null
}

/**
 * Map client lines onto Prisma SaleOrderItem create/update payloads while
 * preserving fulfillment qty and stable line ids when the client sends them.
 */
export function mapSaleOrderItems(lines: any[], existingItems: any[] = []): SaleOrderItemRow[] {
  const usedExisting = new Set<string>()
  return lines.map((item: any) => {
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
    return {
      id: prev?.id,
      productId: optionalUuid(item.productId) ?? null,
      description: item.description ?? item.productName ?? 'Item',
      qty: demand,
      qtyDelivered,
      qtyInvoiced,
      unitPrice: Math.max(0, Number(item.unitPrice ?? 0) || 0),
      taxRate: Math.max(0, Number(item.taxRate ?? 0) || 0),
      lineTotal: Math.max(0, Number(item.lineTotal ?? item.subtotal ?? 0) || 0),
      notes: item.notes ?? null,
      serialNumberId: optionalUuid(
        item.serialNumberId ?? item.serialIds?.[0] ?? prev?.serialNumberId,
      ) ?? null,
    }
  })
}

/**
 * Build a Prisma nested write that upserts by id instead of deleteMany+create.
 * Prevents line UUID churn that breaks chatter / serial / fulfillment links.
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
