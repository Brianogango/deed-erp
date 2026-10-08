import 'server-only'

import prisma from '@/lib/prisma'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { QUOTE_EXTRA_KEYS, readScreenExtras, SALE_ORDER_EXTRA_KEYS } from '@/lib/screen-extras'

/**
 * Sale orders and quotes as the screens use them, read from their tables
 * (the deed_saleOrders / deed_quotes screen copies are frozen — see
 * lib/invoice-read-model.server.ts for the same step on invoices).
 *
 * Columns come from the table, screen-only fields from the row's
 * screen_extras column, and the invoice / delivery links from the invoices
 * and delivery notes that point at the order. The frozen copy is the base
 * only for anything none of those carry, and documents only the copy has
 * stay listed so nothing disappears from a screen.
 */

type Row = Record<string, any>

const CLOSED = new Set(['cancelled', 'canceled', 'void', 'voided'])

function latestOpen<T extends { id: string; status: unknown; createdAt: Date }>(rows: T[]): string | undefined {
  return [...rows]
    .filter(r => !CLOSED.has(String(r.status)))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.id
}

function byId(copy: unknown): { list: Row[]; map: Map<string, Row> } {
  const list = Array.isArray(copy) ? copy as Row[] : []
  return { list, map: new Map(list.filter(r => r?.id).map(r => [String(r.id), r])) }
}

function withCopyOnlyRows(out: Row[], copy: Row[], tableIds: Set<string>, tableRefs: Set<string>): Row[] {
  for (const r of copy) {
    if (r?.id && !tableIds.has(String(r.id)) && !tableRefs.has(String(r.ref ?? ''))) out.push(r)
  }
  return out
}

export async function loadScreenSaleOrders(screenCopy: unknown): Promise<Row[]> {
  const { list, map } = byId(screenCopy)
  const orders = await prisma.saleOrder.findMany({
    include: {
      client: true,
      items: true,
      invoices: { select: { id: true, status: true, createdAt: true } },
      deliveries: { select: { id: true, status: true, createdAt: true } },
      deliveryNotesDirect: { select: { id: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const out = orders.map(order => {
    const { invoices, deliveries, deliveryNotesDirect, screenExtras, ...rest } = order
    const copy = map.get(order.id)
    return {
      ...(copy ?? {}),
      ...mapSaleOrderToClient(rest),
      ...readScreenExtras(screenExtras, SALE_ORDER_EXTRA_KEYS),
      invoiceId: latestOpen(invoices) ?? copy?.invoiceId,
      deliveryId: latestOpen([...deliveryNotesDirect, ...deliveries]) ?? copy?.deliveryId,
    }
  })
  return withCopyOnlyRows(out, list, new Set(orders.map(o => o.id)), new Set(orders.map(o => o.orderNumber)))
}

export async function loadScreenQuotes(screenCopy: unknown): Promise<Row[]> {
  const { list, map } = byId(screenCopy)
  const quotes = await prisma.quote.findMany({
    include: { items: true, client: true, opportunity: true },
    orderBy: { quoteDate: 'desc' },
  })
  const normalized = normalizeQuotesForClient(quotes.map(q => {
    const { screenExtras, ...rest } = q
    return { ...rest, ...readScreenExtras(screenExtras, QUOTE_EXTRA_KEYS) }
  }))
  const out = normalized.map((q: Row) => ({ ...(map.get(String(q.id)) ?? {}), ...q }))
  return withCopyOnlyRows(out, list, new Set(quotes.map(q => q.id)), new Set(quotes.map(q => q.quoteNumber)))
}
