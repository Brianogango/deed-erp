/**
 * My work: everything waiting for this person, across modules, in one list.
 *
 * Someone who works across Repairs, Sales, Inventory and Finance used to
 * visit each module to find out what was waiting. Each queue here is one
 * kind of waiting work, shown only to the roles who can act on it, with the
 * oldest items first and a link to where it is done.
 *
 * Pure: the page hands in the store lists and "now".
 */

import { findInvoicedNotDelivered } from '@/lib/sales/invoiced-not-delivered'

type WorkItem = { id: string; title: string; subtitle: string; href: string; ageDays: number }
type WorkQueue = {
  id: string
  title: string
  hint: string
  href: string
  tone: 'urgent' | 'normal'
  count: number
  items: WorkItem[]
}

type Any = Record<string, any>
export type MyWorkInput = {
  role: string
  userId: string
  /** users.acts_as_technician — gets the technician's repair queue too. */
  actsAsTechnician?: boolean
  now: Date
  repairs: Any[]
  saleOrders: Any[]
  invoices: Any[]
  deliveries: Any[]
  buyBacks: Any[]
  stockAdjustments: Any[]
  serials: Any[]
  purchaseOrders: Any[]
  products?: Any[]
  invoiceHref: (id: string) => string
}

const ROLE_ALIASES: Record<string, string> = { inventory: 'inventory_officer', sales: 'sales_rep', finance: 'finance_officer', lead_tech: 'technical_lead', repair_tech: 'technician' }
const normalizeWorkRole = (role: string) => ROLE_ALIASES[role] ?? role

const DAY = 86_400_000
const ageDays = (date: unknown, now: Date) => {
  const t = new Date(String(date ?? '')).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : 0
}
const kes = (n: unknown) => `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`

const SHOWN = 5

function queue(id: string, title: string, hint: string, href: string, items: WorkItem[], tone: WorkQueue['tone'] = 'normal'): WorkQueue {
  const sorted = [...items].sort((a, b) => b.ageDays - a.ageDays)
  return { id, title, hint, href, tone, count: sorted.length, items: sorted.slice(0, SHOWN) }
}

const repairHref = (r: Any) => `/repairs?id=${encodeURIComponent(r.id)}`

export function buildMyWork(input: MyWorkInput): WorkQueue[] {
  const role = normalizeWorkRole(input.role)
  const is = (...roles: string[]) => role === 'director' || roles.includes(role)
  const { now } = input
  const out: WorkQueue[] = []

  // ── Repairs ───────────────────────────────────────────────────────────
  if (role === 'technician' || role === 'technical_lead' || input.actsAsTechnician === true) {
    const mine = input.repairs.filter(r =>
      r.assignedTechnicianId === input.userId
      && ['assigned', 'diagnosed', 'approved', 'in_repair', 'qc'].includes(r.status))
    out.push(queue('my-repairs', 'My repairs to work on', 'Assigned to you and not yet ready', '/repairs',
      mine.map(r => ({ id: r.id, title: r.ref, subtitle: `${r.productName ?? ''} · ${String(r.status).replace(/_/g, ' ')}`, href: repairHref(r), ageDays: ageDays(r.intakeDate, now) }))))
  }
  if (is('technical_lead')) {
    const unassigned = input.repairs.filter(r => r.status === 'received' && !r.assignedTechnicianId)
    out.push(queue('unassigned-repairs', 'Repairs to assign', 'Booked in, no technician yet', '/repairs',
      unassigned.map(r => ({ id: r.id, title: r.ref, subtitle: `${r.customerName ?? ''} · ${r.productName ?? ''}`, href: repairHref(r), ageDays: ageDays(r.intakeDate, now) })), 'urgent'))
  }
  if (is('admin_officer', 'sales_rep', 'technical_lead')) {
    const waiting = input.repairs.filter(r => r.status === 'awaiting_approval' && ageDays(r.quote?.sentDate ?? r.quote?.createdDate, now) >= 3)
    out.push(queue('quotes-unanswered', 'Clients to chase', 'Repair quotes unanswered for 3+ days', '/repairs',
      waiting.map(r => ({ id: r.id, title: r.ref, subtitle: `${r.customerName ?? ''} · ${r.customerPhone ?? ''} · ${kes(r.quote?.total)}`, href: repairHref(r), ageDays: ageDays(r.quote?.sentDate ?? r.quote?.createdDate, now) }))))
  }
  if (is('admin_officer', 'finance_officer')) {
    const ready = input.repairs.filter(r => r.status === 'ready' && !r.invoiceId && !r.linkedInvoiceId && !r.billingExempt)
    out.push(queue('repairs-to-invoice', 'Repairs to invoice', 'Ready for collection, no invoice yet', '/repairs',
      ready.map(r => ({ id: r.id, title: r.ref, subtitle: `${r.customerName ?? ''} · ${kes(r.quote?.approvedTotal ?? r.quote?.total)}`, href: repairHref(r), ageDays: ageDays(r.repairCompletedDate ?? r.intakeDate, now) }))))
  }
  if (is('finance_officer')) {
    const reissue = input.repairs.filter(r => r.invoiceReissue?.status === 'pending')
    out.push(queue('invoice-reissue', 'Invoices to reissue', 'Client approved a re-quote on a posted invoice', '/repairs',
      reissue.map(r => ({ id: r.id, title: r.invoiceReissue.invoiceRef || r.ref, subtitle: `${r.ref} · ${kes(r.invoiceReissue.previousTotal)} → ${kes(r.invoiceReissue.revisedTotal)}`, href: repairHref(r), ageDays: ageDays(r.invoiceReissue.approvedAt ?? r.invoiceReissue.raisedAt, now) })), 'urgent'))
  }

  // ── Stock ─────────────────────────────────────────────────────────────
  if (is('inventory_officer', 'admin_officer', 'technical_lead')) {
    const requests = input.repairs.flatMap(r => (r.procurementRequests ?? [])
      .filter((p: Any) => p.status === 'pending')
      .map((p: Any) => ({ id: `${r.id}:${p.id}`, title: r.ref, subtitle: (p.items ?? []).map((i: Any) => `${i.qty} × ${i.description || i.productName}`).join(', '), href: '/inventory?tab=parts_requests', ageDays: ageDays(p.requestedDate, now) })))
    out.push(queue('parts-requests', 'Parts requests', 'Correct the count, then raise a purchase order', '/inventory?tab=parts_requests', requests, 'urgent'))
  }
  if (is('inventory_officer', 'technical_lead')) {
    const testing = input.serials.filter(s => s.location === 'pending_testing' && s.status !== 'sold')
    out.push(queue('awaiting-tests', 'Devices awaiting tests', 'Not sellable until each passes', '/inventory?tab=warehouse_view&location=testing',
      testing.map(s => ({ id: s.id, title: s.serial, subtitle: s.productName ?? '', href: '/inventory?tab=warehouse_view&location=testing', ageDays: ageDays(s.receivedDate, now) }))))
  }
  if (is('admin_officer', 'inventory_officer', 'technical_lead')) {
    const adjustments = input.stockAdjustments.filter(a => a.status === 'pending')
    out.push(queue('adjustments', 'Stock adjustments to approve', 'Waiting for an approver', '/inventory?tab=adjustments',
      adjustments.map(a => ({ id: a.id, title: a.ref, subtitle: `${a.type === 'add' ? '+' : '−'}${a.qty} ${a.productName} · by ${a.requestedBy}`, href: '/inventory?tab=adjustments', ageDays: ageDays(a.date, now) }))))
  }
  if (is('inventory_officer', 'admin_officer')) {
    const toReceive = input.purchaseOrders.filter(p => ['confirmed', 'purchase', 'partial', 'sent'].includes(String(p.status)))
    out.push(queue('po-to-receive', 'Purchase orders to receive', 'Ordered, not fully received', '/purchases',
      toReceive.map(p => ({ id: p.id, title: p.ref, subtitle: `${p.vendorName ?? ''} · ${kes(p.total)}`, href: `/purchases?id=${encodeURIComponent(p.id)}`, ageDays: ageDays(p.expectedDate ?? p.date, now) }))))
  }

  // ── Sales & delivery ──────────────────────────────────────────────────
  if (is('sales_rep', 'admin_officer')) {
    const quotations = input.saleOrders.filter(o =>
      ['quotation', 'quotation_sent'].includes(String(o.status))
      && ageDays(o.date ?? o.createdAt, now) >= 3
      && (role !== 'sales_rep' || o.createdByUserId === input.userId || o.salespersonId === input.userId))
    out.push(queue('quotations-open', 'Quotations to follow up', 'Open for 3+ days', '/sales',
      quotations.map(o => ({ id: o.id, title: o.ref ?? o.orderNumber, subtitle: `${o.customerName ?? ''} · ${kes(o.total)}`, href: `/sales?id=${encodeURIComponent(o.id)}`, ageDays: ageDays(o.date ?? o.createdAt, now) }))))
  }
  if (is('sales_rep', 'admin_officer', 'inventory_officer', 'finance_officer')) {
    const billed = findInvoicedNotDelivered({ saleOrders: input.saleOrders, invoices: input.invoices, deliveries: input.deliveries, products: input.products ?? [] })
      .filter(r => role !== 'sales_rep' || input.saleOrders.some(o => o.id === r.saleOrderId && (o.createdByUserId === input.userId || o.salespersonId === input.userId)))
    out.push(queue('invoiced-not-delivered', 'Invoiced, not delivered', 'Machines billed but still counted in stock — validate the delivery with serials', '/sales',
      billed.map(r => ({ id: r.saleOrderId, title: r.ref, subtitle: `${r.customerName} · ${r.machines.map(m => `${m.undelivered} × ${m.name}`).join(', ')}`, href: `/sales?id=${encodeURIComponent(r.saleOrderId)}`, ageDays: ageDays(r.firstInvoiceDate, now) })), 'urgent'))
  }
  if (is('admin_officer', 'inventory_officer')) {
    const dns = input.deliveries.filter(d => ['waiting', 'ready'].includes(String(d.status)))
    out.push(queue('deliveries', 'Deliveries to complete', 'Prepared, not yet validated', '/delivery',
      dns.map(d => ({ id: d.id, title: d.ref, subtitle: `${d.customerName ?? ''} · ${d.saleOrderRef ?? ''}`, href: `/sales?id=${encodeURIComponent(d.saleOrderId)}`, ageDays: ageDays(d.date, now) }))))
  }

  // ── Finance ───────────────────────────────────────────────────────────
  if (is('finance_officer')) {
    const drafts = input.invoices.filter(i => i.type === 'customer_invoice' && i.status === 'draft')
    out.push(queue('draft-invoices', 'Draft invoices to post', 'Not yet in the books', '/finance?tab=invoices',
      drafts.map(i => ({ id: i.id, title: i.ref, subtitle: `${i.partnerName ?? ''} · ${kes(i.total)}`, href: input.invoiceHref(i.id), ageDays: ageDays(i.date, now) }))))
  }
  if (is('finance_officer', 'admin_officer')) {
    const overdue = input.invoices.filter(i =>
      i.type === 'customer_invoice' && !['draft', 'cancelled'].includes(String(i.status))
      && i.dueDate && new Date(i.dueDate).getTime() < now.getTime()
      && Number(i.total ?? 0) - Number(i.amountPaid ?? 0) > 1)
    out.push(queue('overdue-invoices', 'Overdue invoices to collect', 'Past due date with a balance', '/finance?tab=invoices',
      overdue.map(i => ({ id: i.id, title: i.ref, subtitle: `${i.partnerName ?? ''} · ${kes(Number(i.total) - Number(i.amountPaid ?? 0))} due`, href: input.invoiceHref(i.id), ageDays: ageDays(i.dueDate, now) })), 'urgent'))
  }
  if (is('finance_officer')) {
    const tradeIns = input.buyBacks.filter(b => b.status === 'draft')
    out.push(queue('trade-ins', 'Trade-ins to approve', 'Waiting for Finance', '/aftersales',
      tradeIns.map(b => ({ id: b.id, title: b.ref, subtitle: `${b.customerName ?? ''} · ${kes(b.total)}`, href: '/aftersales', ageDays: ageDays(b.date, now) }))))
  }

  // Busiest, most urgent queues first; empty ones are left out.
  return out
    .filter(q => q.count > 0)
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'urgent' ? -1 : 1) || b.count - a.count)
}
