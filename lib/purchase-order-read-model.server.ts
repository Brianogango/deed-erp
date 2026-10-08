import 'server-only'

import prisma from '@/lib/prisma'
import { mapPOToClient } from '@/lib/purchase/po-api-shared'

/**
 * Purchase orders as the screens use them, read from purchase_orders (the
 * deed_purchaseOrders screen copy is frozen — see
 * lib/invoice-read-model.server.ts for the same step on invoices).
 *
 * Header, lines, received / billed counts and status come from the tables
 * (goods receipts and bills move them on the server); approval and repair
 * links from screen_extras. The receipt links are the receipts that point at
 * the order, and the bill link is its latest open bill. Orders only the
 * frozen copy has stay listed so nothing disappears from a screen.
 */

type Row = Record<string, any>

const CLOSED = new Set(['cancelled', 'canceled', 'void', 'voided'])

export async function loadScreenPurchaseOrders(screenCopy: unknown, receiptsCopy: unknown): Promise<Row[]> {
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  const receiptsByPo = new Map<string, string[]>()
  for (const r of Array.isArray(receiptsCopy) ? receiptsCopy as Row[] : []) {
    if (!r?.id || !r?.poId) continue
    const list = receiptsByPo.get(String(r.poId)) ?? []
    list.push(String(r.id))
    receiptsByPo.set(String(r.poId), list)
  }

  const orders = await prisma.purchaseOrder.findMany({
    include: {
      vendor: true,
      items: { include: { product: true } },
      invoices: { select: { id: true, status: true, createdAt: true } },
    },
    orderBy: { orderDate: 'desc' },
  })

  const out: Row[] = orders.map(order => {
    const { invoices, ...rest } = order
    const po: Row = mapPOToClient(rest)
    po.receiptIds = [...new Set([...(po.receiptIds ?? []), ...(receiptsByPo.get(order.id) ?? [])])]
    const bill = [...invoices]
      .filter(i => !CLOSED.has(String(i.status)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    if (bill) po.billId = bill.id
    return po
  })

  const ids = new Set(orders.map(o => o.id))
  const refs = new Set(orders.map(o => o.poNumber))
  for (const r of copy) {
    if (r?.id && !ids.has(String(r.id)) && !refs.has(String(r.ref ?? ''))) out.push(r)
  }
  return out
}
