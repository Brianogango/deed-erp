import 'server-only'

import prisma from '@/lib/prisma'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { QUOTE_EXTRA_KEYS, readScreenExtras, SALE_ORDER_EXTRA_KEYS } from '@/lib/screen-extras'
import { cachedByFingerprint, incrementalRows } from '@/lib/read-model-cache'

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
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  let fingerprint = ''
  return cachedByFingerprint(
    'sale-orders',
    async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT max(updated_at)::text || ':' || count(*) FROM sale_orders),
          -- Whole-row hash: this table's columns are camelCase ("lineTotal"); naming
          -- line_total made this query fail on every load, so the list was rebuilt
          -- every time instead of cached.
          (SELECT count(*) || ':' || md5(coalesce(string_agg(i::text, ',' ORDER BY i.id), '')) FROM sale_order_items i),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(v.id::text || ':' || v.status || ':' || coalesce(v.sale_order_id::text, ''), ',' ORDER BY v.id), ''))
             FROM invoices v WHERE v.sale_order_id IS NOT NULL OR v.id IN (SELECT "A" FROM "_InvoiceSourceSaleOrder")),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(l."A"::text || l."B"::text, ',' ORDER BY l."A", l."B"), '')) FROM "_InvoiceSourceSaleOrder" l),
          (SELECT max(updated_at)::text || ':' || count(*) FROM delivery_notes),
          (SELECT count(*) || ':' || md5(coalesce(string_agg(l."A"::text || l."B"::text, ',' ORDER BY l."A", l."B"), '')) FROM "_DeliveryNoteSaleOrders" l),
          (SELECT md5(coalesce(string_agg(id::text || ':' || name, ',' ORDER BY id), '')) FROM clients)
        ) AS fp`)
      fingerprint = `${rows[0]?.fp ?? ''}|copy:${copy.length}:${String(copy[0]?.id ?? '')}:${String(copy[copy.length - 1]?.id ?? '')}`
      return fingerprint
    },
    // The last two parts (client names, the frozen copy) touch every order;
    // while they are unchanged only changed orders are re-read.
    () => buildScreenSaleOrders(screenCopy, fingerprint.split('|').slice(-2).join('|')),
  )
}

/**
 * One hash per order over its row, its lines, and the invoices and delivery
 * notes linked to it (only the parts the list shows), in list order.
 */
async function orderSignatures(): Promise<Array<{ id: string; sig: string }>> {
  return prisma.$queryRawUnsafe<Array<{ id: string; sig: string }>>(`
    WITH it AS (SELECT sale_order_id, string_agg(i::text, ',' ORDER BY i.id) AS s FROM sale_order_items i GROUP BY sale_order_id),
         -- The list links invoices through the "_InvoiceSourceSaleOrder" join
         -- table (A = invoice, B = order); sale_order_id is hashed as well.
         inv AS (SELECT so_id AS sale_order_id, string_agg(s, ',' ORDER BY s) AS s FROM (
                   SELECT l."B" AS so_id, 'm:' || v.id::text || ':' || v.status || ':' || v.created_at::text AS s
                   FROM "_InvoiceSourceSaleOrder" l JOIN invoices v ON v.id = l."A"
                   UNION ALL
                   SELECT sale_order_id, 'c:' || id::text || ':' || status || ':' || created_at::text
                   FROM invoices WHERE sale_order_id IS NOT NULL) x GROUP BY so_id),
         dn AS (SELECT sale_order_id, string_agg(id::text || ':' || status || ':' || created_at::text, ',' ORDER BY id) AS s
                FROM delivery_notes WHERE sale_order_id IS NOT NULL GROUP BY sale_order_id),
         dm AS (SELECT l."B" AS sale_order_id, string_agg(d.id::text || ':' || d.status || ':' || d.created_at::text, ',' ORDER BY d.id) AS s
                FROM "_DeliveryNoteSaleOrders" l JOIN delivery_notes d ON d.id = l."A" GROUP BY l."B")
    SELECT o.id::text AS id,
           md5(o::text || '#' || coalesce(it.s, '') || '#' || coalesce(inv.s, '') || '#' || coalesce(dn.s, '') || '#' || coalesce(dm.s, '')) AS sig
    FROM sale_orders o
    LEFT JOIN it ON it.sale_order_id = o.id
    LEFT JOIN inv ON inv.sale_order_id = o.id
    LEFT JOIN dn ON dn.sale_order_id = o.id
    LEFT JOIN dm ON dm.sale_order_id = o.id
    ORDER BY o.created_at DESC, o.id`)
}

async function buildScreenSaleOrders(screenCopy: unknown, base = ''): Promise<Row[]> {
  const { list, map } = byId(screenCopy)
  const out = await incrementalRows<Row>({
    name: 'sale-orders',
    base,
    signatures: orderSignatures,
    load: async ids => new Map((await readSaleOrders(ids, map)).map(r => [String(r.id), r])),
  })
  return withCopyOnlyRows([...out], list, new Set(out.map(o => String(o.id))), new Set(out.map(o => String(o.ref ?? ''))))
}

async function readSaleOrders(ids: string[] | null, map: Map<string, Row>): Promise<Row[]> {
  const orders = await prisma.saleOrder.findMany({
    where: ids ? { id: { in: ids } } : undefined,
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
  return out
}

/**
 * Quotes were rebuilt from the tables on every load that included them (the
 * 'sales' time in the slow-load log). Kept now until quotes, their lines,
 * customers or opportunities change — the same scheme as sale orders.
 */
export async function loadScreenQuotes(screenCopy: unknown): Promise<Row[]> {
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  return cachedByFingerprint(
    'quotes',
    async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ fp: string | null }>>(`
        SELECT concat_ws('|',
          (SELECT max(updated_at)::text || ':' || count(*) FROM quotes),
          (SELECT count(*) || ':' || coalesce(sum(line_total), 0) || ':' || coalesce(sum(qty), 0) FROM quote_items),
          (SELECT md5(coalesce(string_agg(concat_ws(':', id::text, name, company_name, email, phone), ',' ORDER BY id), '')) FROM clients),
          (SELECT max(updated_at)::text || ':' || count(*) FROM opportunities)
        ) AS fp`)
      return `${rows[0]?.fp ?? ''}|copy:${copy.length}:${String(copy[0]?.id ?? '')}:${String(copy[copy.length - 1]?.id ?? '')}`
    },
    () => buildScreenQuotes(screenCopy),
  )
}

async function buildScreenQuotes(screenCopy: unknown): Promise<Row[]> {
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
  // Plain JSON, as the browser receives it: the attached customer and deal
  // carry Decimal money fields, which the list cache cannot copy.
  return JSON.parse(JSON.stringify(
    withCopyOnlyRows(out, list, new Set(quotes.map(q => q.id)), new Set(quotes.map(q => q.quoteNumber))),
  ))
}
