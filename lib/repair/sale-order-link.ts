/**
 * Resolve the workshop repair that a sale order was raised from.
 * Repair quotes persist as SO notes like "Repair quote — REP/0289 — …"
 * and `saleOrderId` on the repair blob.
 */

export type RepairSaleOrderLink = {
  id?: string | null
  saleOrderId?: string | null
  linkedSaleOrderId?: string | null
  saleOrderRef?: string | null
  linkedSaleOrderRef?: string | null
  ref?: string | null
  invoiceId?: string | null
}

export type SaleOrderRepairHint = {
  id?: string | null
  ref?: string | null
  orderNumber?: string | null
  quotationRef?: string | null
  notes?: string | null
}

const REPAIR_REF_RE = /\bREP\/\d{4}\/\d+\b|\bREP\/\d+\b/i

export function extractRepairRefFromText(text?: string | null): string | undefined {
  const match = String(text ?? '').match(REPAIR_REF_RE)
  return match ? match[0].toUpperCase() : undefined
}

export function findRepairForSaleOrder<T extends RepairSaleOrderLink>(
  repairs: T[] | null | undefined,
  order: SaleOrderRepairHint | null | undefined,
): T | undefined {
  if (!order || !Array.isArray(repairs) || repairs.length === 0) return undefined
  const orderId = String(order.id ?? '').trim()
  if (orderId) {
    const byId = repairs.find(r =>
      String(r.saleOrderId ?? '') === orderId || String(r.linkedSaleOrderId ?? '') === orderId,
    )
    if (byId) return byId
  }
  const refs = [order.ref, order.orderNumber, order.quotationRef]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
  if (refs.length) {
    const byRef = repairs.find(r =>
      refs.includes(String(r.saleOrderRef ?? '').trim())
      || refs.includes(String(r.linkedSaleOrderRef ?? '').trim()),
    )
    if (byRef) return byRef
  }
  const repairRef = extractRepairRefFromText(order.notes)
  if (!repairRef) return undefined
  return repairs.find(r => String(r.ref ?? '').toUpperCase() === repairRef)
}

/** Back-link the workshop job to the customer invoice without changing repair status. */
export function applyInvoiceLinkToRepair<T extends Record<string, unknown>>(
  repair: T,
  invoice: { id: string; ref?: string | null; date?: string | null },
): T {
  return {
    ...repair,
    invoiceId: invoice.id,
    linkedInvoiceId: invoice.id,
    ...(invoice.date ? { invoiceDate: invoice.date } : {}),
    ...(invoice.ref ? { linkedInvoiceRef: invoice.ref } : {}),
  }
}

export function stampInvoiceOnMatchingRepair<T extends RepairSaleOrderLink & Record<string, unknown>>(
  repairs: T[],
  repair: T | undefined,
  invoice: { id: string; ref?: string | null; date?: string | null },
): T[] {
  if (!repair?.id || repair.invoiceId) return repairs
  return repairs.map(r => (r.id === repair.id ? applyInvoiceLinkToRepair(r, invoice) : r))
}
