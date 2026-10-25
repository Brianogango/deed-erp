import 'server-only'
import prisma from '@/lib/prisma'

/**
 * A vendor bill reserves quantities on its purchase order's lines
 * (qtyBilled) when it is created. Cancelling or voiding the bill used to
 * leave that reservation behind, so the order kept saying those units were
 * billed: a later return then credited a bill nobody owed (VCN/2026/0005),
 * and Create Bill could refuse units that were free to bill again.
 *
 * Call once, when a bill moves into cancelled / voided. Lines that name their
 * PO line release there; older lines fall back to the PO line for the same
 * product. Counts never go below zero. Credit notes (negative bills) never
 * reserved anything and are skipped.
 */
export async function releaseCancelledBillQty(invoiceId: string): Promise<number> {
  const bill = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      purchaseOrderId: true, documentType: true, totalAmount: true,
      items: { select: { qty: true, productId: true, purchaseOrderItemId: true } },
    },
  })
  if (!bill?.purchaseOrderId || bill.documentType !== 'vendor_bill' || Number(bill.totalAmount) <= 0) return 0

  const poItems = await prisma.purchaseOrderItem.findMany({
    where: { poId: bill.purchaseOrderId },
    select: { id: true, productId: true, qtyBilled: true },
  })
  const release = new Map<string, number>()
  for (const item of bill.items) {
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0))
    if (!qty) continue
    const line = poItems.find(p => p.id === item.purchaseOrderItemId)
      ?? poItems.find(p => item.productId && p.productId === item.productId)
    if (line) release.set(line.id, (release.get(line.id) ?? 0) + qty)
  }
  let released = 0
  for (const [lineId, qty] of release) {
    const line = poItems.find(p => p.id === lineId)!
    const next = Math.max(0, line.qtyBilled - qty)
    if (next === line.qtyBilled) continue
    await prisma.purchaseOrderItem.update({ where: { id: lineId }, data: { qtyBilled: next } })
    released += line.qtyBilled - next
  }
  if (released) {
    const { notifyStoreKeysChanged } = await import('@/lib/server-store')
    await notifyStoreKeysChanged(['deed_purchaseOrders']).catch(() => {})
  }
  return released
}
