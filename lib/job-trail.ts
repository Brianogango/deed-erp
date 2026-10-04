/**
 * The job trail: one customer job followed across modules —
 * Repair → Quote → Sale order → Invoice → Payment → Delivery — and the one
 * thing to do next.
 *
 * People who work across modules used to have to know that the invoice lives
 * in Finance, the delivery inside the sale order, the quote in Sales. From any
 * of those records the trail now shows the others and links to them.
 *
 * Pure: the component hands in the store lists.
 */

export type TrailKind = 'repair' | 'quote' | 'sale_order' | 'invoice' | 'payment' | 'delivery'

export type TrailStep = {
  kind: TrailKind
  label: string
  ref: string
  status: string
  href: string
  state: 'done' | 'current' | 'waiting'
}

export type NextStep = { label: string; href: string; tone: 'action' | 'waiting' | 'done' }

type Repair = { id: string; ref: string; status: string; saleOrderId?: string; linkedSaleOrderId?: string; salesQuoteId?: string; invoiceId?: string; linkedInvoiceId?: string; previousInvoiceIds?: string[]; quote?: { approvedDate?: string } | null }
type SaleOrder = { id: string; ref?: string; orderNumber?: string; status: string; repairId?: string; quoteId?: string }
type Quote = { id: string; ref?: string; quoteNumber?: string; status?: string; repairId?: string; saleOrderId?: string }
type Invoice = { id: string; ref?: string; type?: string; status: string; total?: number; amountPaid?: number; saleOrderId?: string; repairId?: string }
type Delivery = { id: string; ref: string; status: string; saleOrderId: string }

export type TrailData = {
  repairs: Repair[]
  saleOrders: SaleOrder[]
  quotes: Quote[]
  invoices: Invoice[]
  deliveries: Delivery[]
  invoiceHref: (id: string) => string
}

export type TrailStart = { kind: 'repair' | 'sale_order' | 'invoice' | 'delivery'; id: string }

const pretty = (s: string) => String(s || '').replace(/_/g, ' ')

export function buildJobTrail(start: TrailStart, data: TrailData): { steps: TrailStep[]; next: NextStep | null } {
  // Find the anchors: the repair (if any) and the sale order.
  let repair: Repair | undefined
  let order: SaleOrder | undefined
  if (start.kind === 'repair') repair = data.repairs.find(r => r.id === start.id)
  if (start.kind === 'sale_order') order = data.saleOrders.find(o => o.id === start.id)
  if (start.kind === 'invoice') {
    const inv = data.invoices.find(i => i.id === start.id)
    if (inv?.saleOrderId) order = data.saleOrders.find(o => o.id === inv.saleOrderId)
    if (inv?.repairId) repair = data.repairs.find(r => r.id === inv.repairId)
  }
  if (start.kind === 'delivery') {
    const dn = data.deliveries.find(d => d.id === start.id)
    if (dn) order = data.saleOrders.find(o => o.id === dn.saleOrderId)
  }
  if (!order && repair) {
    const soId = repair.linkedSaleOrderId ?? repair.saleOrderId
    order = (soId ? data.saleOrders.find(o => o.id === soId) : undefined)
      ?? data.saleOrders.find(o => o.repairId === repair!.id)
  }
  if (!repair && order?.repairId) repair = data.repairs.find(r => r.id === order!.repairId)

  const replaced = new Set(repair?.previousInvoiceIds ?? [])
  const invoices = data.invoices.filter(i =>
    i.type !== 'vendor_bill'
    && i.status !== 'cancelled'
    && !replaced.has(i.id)
    && ((order && i.saleOrderId === order.id) || (repair && (i.repairId === repair.id || i.id === repair.invoiceId || i.id === repair.linkedInvoiceId))),
  )
  const quote = data.quotes.find(q =>
    (repair && (q.id === repair.salesQuoteId || q.repairId === repair.id))
    || (order && (q.saleOrderId === order.id || q.id === order.quoteId)),
  )
  const deliveries = order ? data.deliveries.filter(d => d.saleOrderId === order!.id && d.status !== 'cancelled') : []

  const steps: TrailStep[] = []
  const orderHref = order ? `/sales?id=${encodeURIComponent(order.id)}` : ''
  if (repair) {
    const done = ['ready', 'verified_released', 'delivered', 'collected', 'closed', 'invoiced'].includes(repair.status)
    steps.push({ kind: 'repair', label: 'Repair', ref: repair.ref, status: pretty(repair.status), href: `/repairs?id=${encodeURIComponent(repair.id)}`, state: done ? 'done' : 'current' })
  }
  if (quote) {
    const approved = Boolean(repair?.quote?.approvedDate) || ['accepted', 'approved'].includes(String(quote.status))
    steps.push({ kind: 'quote', label: 'Quote', ref: String(quote.quoteNumber ?? quote.ref ?? ''), status: approved ? 'approved' : pretty(String(quote.status ?? 'sent')), href: orderHref || `/sales?id=${encodeURIComponent(quote.id)}`, state: approved ? 'done' : 'current' })
  }
  if (order) {
    const confirmed = order.status === 'sale'
    steps.push({ kind: 'sale_order', label: 'Sale order', ref: String(order.ref ?? order.orderNumber ?? ''), status: confirmed ? 'confirmed' : pretty(order.status), href: orderHref, state: confirmed ? 'done' : 'current' })
  }
  for (const inv of invoices) {
    const posted = inv.status !== 'draft'
    steps.push({ kind: 'invoice', label: 'Invoice', ref: String(inv.ref ?? ''), status: posted ? 'posted' : 'draft', href: data.invoiceHref(inv.id), state: posted ? 'done' : 'current' })
    if (posted) {
      const total = Number(inv.total ?? 0)
      const paid = Number(inv.amountPaid ?? 0)
      const state = total > 0 && paid >= total - 0.5 ? 'done' : 'current'
      steps.push({ kind: 'payment', label: 'Payment', ref: String(inv.ref ?? ''), status: paid <= 0 ? 'unpaid' : state === 'done' ? 'paid' : `KES ${Math.round(paid).toLocaleString('en-KE')} of ${Math.round(total).toLocaleString('en-KE')}`, href: data.invoiceHref(inv.id), state })
    }
  }
  for (const dn of deliveries) {
    steps.push({ kind: 'delivery', label: 'Delivery', ref: dn.ref, status: pretty(dn.status), href: orderHref, state: dn.status === 'done' ? 'done' : 'current' })
  }

  return { steps, next: nextStep({ repair, order, invoices, deliveries, orderHref, invoiceHref: data.invoiceHref }) }
}

function nextStep(ctx: {
  repair?: Repair
  order?: SaleOrder
  invoices: Invoice[]
  deliveries: Delivery[]
  orderHref: string
  invoiceHref: (id: string) => string
}): NextStep | null {
  const { repair, order, invoices, deliveries } = ctx
  const repairHref = repair ? `/repairs?id=${encodeURIComponent(repair.id)}` : ''
  if (repair) {
    if (repair.status === 'awaiting_approval') return { label: 'Waiting for the client to approve the quote', href: repairHref, tone: 'waiting' }
    if (['received', 'assigned', 'diagnosed', 'declined'].includes(repair.status)) return { label: 'Diagnose and quote the repair', href: repairHref, tone: 'action' }
    if (['approved', 'awaiting_parts', 'in_repair', 'qc'].includes(repair.status)) return { label: 'Finish the repair and pass QC', href: repairHref, tone: 'action' }
  }
  if (order && order.status !== 'sale' && order.status !== 'cancelled') return { label: 'Confirm the sale order', href: ctx.orderHref, tone: 'action' }
  const draft = invoices.find(i => i.status === 'draft')
  if (draft) return { label: `Post invoice ${draft.ref ?? ''}`.trim(), href: ctx.invoiceHref(draft.id), tone: 'action' }
  if (order && order.status === 'sale' && invoices.length === 0) {
    return repair
      ? { label: 'Create the invoice', href: repairHref, tone: 'action' }
      : { label: 'Create the invoice', href: ctx.orderHref, tone: 'action' }
  }
  const unpaid = invoices.find(i => i.status !== 'draft' && Number(i.amountPaid ?? 0) < Number(i.total ?? 0) - 0.5)
  if (unpaid) return { label: `Record payment on ${unpaid.ref ?? 'the invoice'}`, href: ctx.invoiceHref(unpaid.id), tone: 'action' }
  const openDn = deliveries.find(d => d.status !== 'done')
  if (openDn) return { label: `Validate delivery ${openDn.ref}`, href: ctx.orderHref, tone: 'action' }
  if (repair && ['ready', 'verified_released'].includes(repair.status)) return { label: 'Hand the device to the client', href: repairHref, tone: 'action' }
  if (order || repair) return { label: 'Nothing left to do on this job', href: repairHref || ctx.orderHref, tone: 'done' }
  return null
}
