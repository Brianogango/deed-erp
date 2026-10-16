/**
 * Read-only audit of confirmed sales orders for the faults seen on SO/2026/0111–0113:
 *  - invoicedBeforeDelivery: a live invoice exists but no delivery of the order is Done, and
 *    the order carries stock items (an invoice should follow a validated delivery);
 *  - possibleDuplicates: confirmed orders for the same customer with the same total close
 *    together in time, so one lot may have been entered more than once;
 *  - held serials are counted on every order that has no completed delivery.
 */
import { isNonStockProduct } from '@/lib/sales/non-stock-line'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'

type Rec = Record<string, any>

export interface OrderRow {
  ref: string
  customer: string
  total: number
  date: string
  invoices: string[]
  deliveries: string[]
  heldSerials: number
}
export interface OrderAudit {
  checkedOrders: number
  invoicedBeforeDelivery: Array<OrderRow & { invoiced: number; paid: number }>
  possibleDuplicates: Array<{ customer: string; total: number; orders: OrderRow[] }>
}

const DAY = 86_400_000
const num = (v: unknown) => Number(v) || 0

export function auditSalesOrders(input: { orders: Rec[]; invoices: Rec[]; deliveries: Rec[]; serials: Rec[]; products: Rec[]; duplicateWindowDays?: number }): OrderAudit {
  const windowMs = (input.duplicateWindowDays ?? 45) * DAY
  const productById = new Map(input.products.map(p => [String(p.id), p]))
  const confirmed = input.orders.filter(o => normalizeSaleStatus(o.status) === 'sale')

  const rowFor = (o: Rec): OrderRow => {
    const id = String(o.id)
    const invs = input.invoices.filter(i => String(i.saleOrderId) === id && !['cancelled', 'voided', 'void'].includes(String(i.status)))
    const dels = input.deliveries.filter(d => String(d.saleOrderId) === id && d.status !== 'cancelled')
    return {
      ref: String(o.ref ?? o.orderNumber ?? id),
      customer: String(o.customerName ?? o.customerId ?? ''),
      total: num(o.total ?? o.totalAmount),
      date: String(o.date ?? o.orderDate ?? '').slice(0, 10),
      invoices: invs.map(i => String(i.ref ?? i.invoiceNumber ?? i.id)),
      deliveries: dels.map(d => `${d.ref} (${d.status})`),
      heldSerials: input.serials.filter(s => String(s.saleOrderId) === id && ['assigned', 'reserved'].includes(String(s.status).toLowerCase())).length,
    }
  }

  const invoicedBeforeDelivery: OrderAudit['invoicedBeforeDelivery'] = []
  for (const o of confirmed) {
    const id = String(o.id)
    const hasStockLine = (Array.isArray(o.lines) ? o.lines : []).some((l: Rec) => l.productId && !isNonStockProduct(productById.get(String(l.productId))))
    if (!hasStockLine) continue
    const invs = input.invoices.filter(i => String(i.saleOrderId) === id && !['cancelled', 'voided', 'void', 'draft'].includes(String(i.status)))
    if (invs.length === 0) continue
    const anyDone = input.deliveries.some(d => String(d.saleOrderId) === id && d.status === 'done')
    if (anyDone) continue
    invoicedBeforeDelivery.push({ ...rowFor(o), invoiced: invs.reduce((s, i) => s + num(i.total), 0), paid: invs.reduce((s, i) => s + num(i.amountPaid), 0) })
  }

  const groups = new Map<string, Rec[]>()
  for (const o of confirmed) {
    const key = `${String(o.customerId ?? o.customerName ?? '')}|${Math.round(num(o.total ?? o.totalAmount))}`
    groups.set(key, [...(groups.get(key) ?? []), o])
  }
  const possibleDuplicates: OrderAudit['possibleDuplicates'] = []
  for (const list of groups.values()) {
    if (list.length < 2 || num(list[0].total ?? list[0].totalAmount) <= 0) continue
    const times = list.map(o => new Date(String(o.date ?? o.orderDate ?? '')).getTime()).filter(Number.isFinite).sort((a, b) => a - b)
    if (times.length >= 2 && times[times.length - 1] - times[0] > windowMs) continue
    possibleDuplicates.push({ customer: String(list[0].customerName ?? ''), total: num(list[0].total ?? list[0].totalAmount), orders: list.map(rowFor) })
  }

  return { checkedOrders: confirmed.length, invoicedBeforeDelivery, possibleDuplicates }
}
