/**
 * Prisma PurchaseOrderItem.qtyReceived can lag the goods that were actually
 * received: GRN matching used to require an exact product UUID, and a later
 * PO PATCH can recreate lines without finding the previous row. Vendor-bill
 * posting then rejects a fully received order ("unbilled 0") even though the
 * UI shows FULLY RECEIVED.
 *
 * Reconcile from GRN rows and the blob PO (the UI source of truth) before
 * 3-way match. Never decreases qtyReceived; never exceeds qtyOrdered.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

type DbClient = Prisma.TransactionClient | typeof prisma

const qty = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0))

export async function reconcilePrismaPoReceivedQty(
  poId: string,
  client: DbClient = prisma,
): Promise<void> {
  const po = await client.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: true, grns: { include: { items: true } } },
  })
  if (!po?.items?.length) return

  const receivedByPoItem = new Map<string, number>()
  for (const grn of po.grns ?? []) {
    for (const item of grn.items ?? []) {
      receivedByPoItem.set(
        item.poItemId,
        (receivedByPoItem.get(item.poItemId) || 0) + qty(item.qtyReceived),
      )
    }
  }

  const state = await loadAppState(['deed_purchaseOrders'])
  const blobList = Array.isArray(state.deed_purchaseOrders) ? (state.deed_purchaseOrders as any[]) : []
  const blob = blobList.find((row: any) => row?.id === poId || String(row?.ref ?? '') === po.poNumber)
  const blobItems: Array<{ id: string; productId: string; description: string | null; qtyReceived: number }> =
    (Array.isArray(blob?.lines) ? blob.lines : []).map((line: any) => ({
      id: String(line.id || ''),
      productId: String(line.productId || ''),
      description: line.productName ?? line.description ?? null,
      qtyReceived: qty(line.qtyReceived),
    }))

  for (const item of po.items) {
    const blobLine = blobItems.length
      ? resolveVendorBillPoItem(blobItems, {
          purchaseOrderItemId: item.id,
          productId: item.productId,
          description: item.description,
        })
      : undefined
    const blobReceived = blobLine
      ? qty(blobItems.find(line => line.id === blobLine.id)?.qtyReceived)
      : 0
    const next = Math.min(
      qty(item.qtyOrdered),
      Math.max(
        qty(item.qtyReceived),
        receivedByPoItem.get(item.id) || 0,
        blobReceived,
      ),
    )
    if (next > qty(item.qtyReceived)) {
      await client.purchaseOrderItem.update({
        where: { id: item.id },
        data: { qtyReceived: next },
      })
    }
  }
}
