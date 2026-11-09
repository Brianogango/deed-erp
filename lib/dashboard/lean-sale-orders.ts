/**
 * Sale orders as the dashboard needs them: the fields its sales pipeline,
 * sales analytics, rep performance and stock figures read, and nothing else.
 * About a fifth of the full rows, so the dashboard no longer downloads the
 * whole sale-order list (lib/app-state-hydration.ts).
 *
 * Pure — used by the server route.
 */
type Row = Record<string, any>

const ORDER_FIELDS = [
  'id', 'ref', 'status', 'date', 'total', 'customerId', 'customerName',
  'salespersonId', 'salespersonName', 'createdByUserId', 'createdByName',
  'createdAt', 'confirmedAt', 'validUntil', 'source',
] as const

const LINE_FIELDS = ['productId', 'productName', 'qty', 'qtyDelivered', 'qtyInvoiced', 'invoicePolicy', 'subtotal'] as const

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {}
  for (const f of fields) if (row[f] !== undefined && row[f] !== null && row[f] !== '') out[f] = row[f]
  return out
}

export function leanSaleOrder(order: Row): Row {
  const lean = pick(order, ORDER_FIELDS)
  lean.lines = (Array.isArray(order.lines) ? order.lines : []).map((line: Row) => pick(line ?? {}, LINE_FIELDS))
  return lean
}

export function leanSaleOrders(orders: unknown): Row[] {
  return (Array.isArray(orders) ? orders : []).filter(o => o && typeof o === 'object').map(leanSaleOrder)
}
