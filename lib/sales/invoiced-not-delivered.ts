/**
 * Sale orders billed for laptops / serial-tracked machines that have not left
 * through a validated delivery. Until the delivery is validated (serials
 * picked), those machines still count in Ready for Sale — the gap behind an
 * overstated stock count. Down-payment invoices are deposits, not a sale of
 * the goods, so they do not count here.
 */
import { deliveredByProductFromDoneDeliveries } from '@/lib/odoo-sales-flow'

type Row = Record<string, any>

type InvoicedNotDelivered = {
  saleOrderId: string
  ref: string
  customerName: string
  invoiceRefs: string[]
  firstInvoiceDate: string
  machines: Array<{ productId: string; name: string; undelivered: number }>
  undelivered: number
}

const CLOSED = new Set(['draft', 'cancelled', 'canceled', 'voided', 'void'])

function isSerialTracked(product: Row | undefined): boolean {
  return Boolean(product && (product.requiresSerial === true || String(product.trackingMethod ?? '').toUpperCase() === 'SERIAL'))
}

export function findInvoicedNotDelivered(input: {
  saleOrders: Row[]
  invoices: Row[]
  deliveries: Row[]
  products: Row[]
}): InvoicedNotDelivered[] {
  const products = new Map(input.products.map(p => [String(p.id), p]))
  const invoicesBySo = new Map<string, Row[]>()
  for (const inv of input.invoices) {
    if (!inv?.saleOrderId || inv.type === 'vendor_bill' || inv.isCreditNote || inv.isDownPayment) continue
    if (Number(inv.total) <= 0 || CLOSED.has(String(inv.status))) continue
    const list = invoicesBySo.get(String(inv.saleOrderId)) ?? []
    list.push(inv)
    invoicesBySo.set(String(inv.saleOrderId), list)
  }
  const out: InvoicedNotDelivered[] = []
  for (const so of input.saleOrders) {
    if (!['sale', 'done'].includes(String(so?.status))) continue
    const invoices = invoicesBySo.get(String(so.id))
    if (!invoices?.length) continue
    const ordered = new Map<string, { name: string; qty: number }>()
    for (const line of (so.lines ?? []) as Row[]) {
      const id = String(line?.productId ?? '')
      if (!id || !isSerialTracked(products.get(id))) continue
      const prev = ordered.get(id)
      ordered.set(id, { name: String(line.productName || products.get(id)?.name || 'Machine'), qty: (prev?.qty ?? 0) + (Number(line.qty) || 0) })
    }
    if (!ordered.size) continue
    const delivered = deliveredByProductFromDoneDeliveries(input.deliveries as never, String(so.id))
    const machines = [...ordered.entries()]
      .map(([productId, o]) => ({ productId, name: o.name, undelivered: Math.max(0, o.qty - (delivered[productId] ?? 0)) }))
      .filter(m => m.undelivered > 0)
    if (!machines.length) continue
    const dates = invoices.map(i => String(i.date ?? '')).filter(Boolean).sort()
    out.push({
      saleOrderId: String(so.id),
      ref: String(so.ref || so.orderNumber || so.id),
      customerName: String(so.customerName ?? ''),
      invoiceRefs: invoices.map(i => String(i.ref ?? '')).filter(Boolean),
      firstInvoiceDate: dates[0] ?? '',
      machines,
      undelivered: machines.reduce((s, m) => s + m.undelivered, 0),
    })
  }
  return out.sort((a, b) => a.firstInvoiceDate.localeCompare(b.firstInvoiceDate))
}
