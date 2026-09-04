/**
 * Match a vendor-bill line onto a purchase-order item.
 *
 * Blob POs and Prisma POs can carry different product UUIDs for the same
 * catalogue row (resolvePOLineProducts remaps on write). Draft bills created
 * from the blob PO therefore fail a productId-only 3-way match even when the
 * line is clearly the same product. Fall back to the PO line description and,
 * for a single-line PO, the only remaining item.
 */

export type PoItemForBillMatch = {
  id: string
  productId: string
  description?: string | null
}

export type BillLineForPoMatch = {
  purchaseOrderItemId?: string | null
  productId?: string | null
  description?: string | null
}

export function purchaseLineName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s*[×x]\s*\d+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveVendorBillPoItem<T extends PoItemForBillMatch>(
  poItems: T[],
  bill: BillLineForPoMatch,
): T | undefined {
  const poItemId = String(bill.purchaseOrderItemId || '').trim()
  if (poItemId) {
    const byId = poItems.find(item => item.id === poItemId)
    if (byId) return byId
  }

  const productId = String(bill.productId || '').trim()
  if (productId) {
    const byProduct = poItems.filter(item => item.productId === productId)
    if (byProduct.length === 1) return byProduct[0]
    if (byProduct.length > 1) return undefined
  }

  const billName = purchaseLineName(bill.description)
  if (billName) {
    const byName = poItems.filter(item => {
      const poName = purchaseLineName(item.description)
      if (!poName) return false
      return billName === poName || billName.includes(poName) || poName.includes(billName)
    })
    if (byName.length === 1) return byName[0]
  }

  if (poItems.length === 1) return poItems[0]
  return undefined
}
