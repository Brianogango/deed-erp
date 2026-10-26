import 'server-only'

import prisma from '@/lib/prisma'
import { cachedByFingerprint } from '@/lib/read-model-cache'
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

  const receiptLinks = [...receiptsByPo].map(([po, ids]) => `${po}:${ids.join(',')}`).sort().join(';')
  return cachedByFingerprint(
    'purchaseOrders',
    async () => {
      // Whole-row hashes of the orders and their lines; vendors, products and
      // bills only as far as the list shows them.
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT count(*) || ':' || md5(coalesce(string_agg(o::text, ',' ORDER BY o.id), '')) FROM purchase_orders o),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(i::text, ',' ORDER BY i.id), '')) FROM purchase_order_items i),
          (SELECT md5(coalesce(string_agg(c.id::text || ':' || c.name, ',' ORDER BY c.id), ''))
             FROM clients c WHERE c.id IN (SELECT client_id FROM purchase_orders)),
          (SELECT md5(coalesce(string_agg(p::text, ',' ORDER BY p.id), ''))
             FROM products p WHERE p.id IN (SELECT product_id FROM purchase_order_items)),
          (SELECT md5(coalesce(string_agg(b.id::text || ':' || b.status || ':' || b.purchase_order_id, ',' ORDER BY b.id), ''))
             FROM invoices b WHERE b.purchase_order_id IS NOT NULL)
        ) AS fp`)
      const fp = rows[0]?.fp
      return fp ? `${fp}|copy:${copy.length}:${String(copy[0]?.id ?? '')}:${String(copy[copy.length - 1]?.id ?? '')}|receipts:${receiptLinks}` : ''
    },
    () => buildScreenPurchaseOrders(copy, receiptsByPo),
  )
}

async function buildScreenPurchaseOrders(copy: Row[], receiptsByPo: Map<string, string[]>): Promise<Row[]> {
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
