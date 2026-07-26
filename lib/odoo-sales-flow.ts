// Odoo-style quotation-to-payment workflow semantics.
//
// This module is the single source of truth for:
//   • Sale order states  (Quotation → Quotation Sent → Sales Order | Cancelled)
//   • Delivery states    (Draft → Waiting → Ready → Done | Cancelled)
//   • Invoice document states (Draft → Posted | Cancelled) and the separately
//     computed payment status (Not Paid / In Payment / Partially Paid / Paid /
//     Reversed) — payment status is never chosen by a user.
//   • Sale-order invoice status (Nothing to Invoice / To Invoice / Fully
//     Invoiced / Upselling Opportunity), driven by per-line invoiced
//     quantities and the product invoicing policy (ordered vs delivered).
//
// Everything here is pure and unit-tested. The store, API routes and UI all
// consume these helpers so the vocabulary can never drift between layers.

// ─── Sale order states ───────────────────────────────────────────────────────

export type OdooSaleStatus = 'quotation' | 'quotation_sent' | 'sale' | 'cancelled'

export const SALE_STATUS_LABELS: Record<OdooSaleStatus, string> = {
  quotation: 'Quotation',
  quotation_sent: 'Quotation Sent',
  sale: 'Sales Order',
  cancelled: 'Cancelled',
}

/** The user-facing status bar. Cancelled is an exception state, never a stage. */
export const SALE_STATUS_BAR: OdooSaleStatus[] = ['quotation', 'quotation_sent', 'sale']

export const SALE_STATUSES = new Set<string>(['quotation', 'quotation_sent', 'sale', 'cancelled'])

/**
 * Map any historical status value onto the Odoo vocabulary. The legacy flow
 * stored fulfilment progress ("delivered", "invoiced") and the approval gate
 * ("pending_approval", "approved") inside the sale-order status; those all
 * collapse onto the Odoo stage they belong to. Fulfilment/invoicing progress
 * is carried by the delivery records and per-line invoiced quantities instead.
 */
export function normalizeSaleStatus(raw: unknown): OdooSaleStatus {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (SALE_STATUSES.has(s)) return s as OdooSaleStatus
  switch (s) {
    case 'sent':
      return 'quotation_sent'
    case 'confirmed':
    case 'delivered':
    case 'invoiced':
    case 'reserved':
    case 'paid':
      return 'sale'
    case 'pending_approval':
    case 'approved':
    case 'pending':
    case 'draft':
    case 'on_hold':
    default:
      return 'quotation'
  }
}

/** Approval flag implied by a legacy status value (used during normalization). */
export function legacyApprovalFromStatus(raw: unknown): 'pending' | 'approved' | undefined {
  if (raw === 'pending_approval') return 'pending'
  if (raw === 'approved') return 'approved'
  return undefined
}

export function isQuotationStage(status: OdooSaleStatus): boolean {
  return status === 'quotation' || status === 'quotation_sent'
}

// ─── Server-side transition rules ────────────────────────────────────────────

/** Roles allowed to confirm a quotation into a Sales Order. */
export const SALE_CONFIRM_ROLES = ['director', 'sales_rep', 'admin_officer']

/**
 * Validate a sale-order status transition. Returns null when the transition
 * is legal for the role, otherwise a human-readable error. The API enforces
 * this server-side so a crafted PATCH can never skip workflow states.
 * Cancellation blockers (completed deliveries, posted invoices, payments)
 * are data-dependent and checked separately via saleOrderCancelBlockers.
 */
export function saleTransitionError(
  from: OdooSaleStatus,
  to: OdooSaleStatus,
  role: string,
): string | null {
  if (from === to) return null
  switch (to) {
    case 'quotation_sent':
      // Only an unconfirmed quotation can be marked as sent.
      return from === 'quotation' ? null
        : `Cannot mark a ${SALE_STATUS_LABELS[from]} as Quotation Sent`
    case 'sale':
      if (!isQuotationStage(from)) return `Cannot confirm a ${SALE_STATUS_LABELS[from]}`
      if (!SALE_CONFIRM_ROLES.includes(role)) return 'Your role cannot confirm Sales Orders'
      return null
    case 'cancelled':
      // Any state may request cancellation; sale-order blockers are checked
      // against dependent records by the caller.
      return null
    case 'quotation':
      // "Set to Quotation" — allowed from sent, cancelled, or a confirmed
      // order (the store releases reservations and pending deliveries).
      return null
    default:
      return `Unknown sale status "${to}"`
  }
}

// ─── Invoicing policy & sale-order invoice status ────────────────────────────

export type InvoicePolicy = 'order' | 'delivery'

export const INVOICE_POLICY_LABELS: Record<InvoicePolicy, string> = {
  order: 'Ordered Quantities',
  delivery: 'Delivered Quantities',
}

export interface InvoiceableLine {
  qty: number
  qtyDelivered?: number
  qtyInvoiced?: number
  invoicePolicy?: InvoicePolicy
}

/** Quantity that may be invoiced right now for a line, per its policy. */
export function invoiceableQty(line: InvoiceableLine): number {
  const ordered = Number(line.qty) || 0
  const delivered = Number(line.qtyDelivered) || 0
  const invoiced = Number(line.qtyInvoiced) || 0
  const policy: InvoicePolicy = line.invoicePolicy === 'delivery' ? 'delivery' : 'order'
  const invoiceBase = policy === 'delivery' ? delivered : Math.max(ordered, 0)
  return Math.max(0, invoiceBase - invoiced)
}

export type SoInvoiceStatus = 'no' | 'to_invoice' | 'invoiced' | 'upselling'

export const SO_INVOICE_STATUS_LABELS: Record<SoInvoiceStatus, string> = {
  no: 'Nothing to Invoice',
  to_invoice: 'To Invoice',
  invoiced: 'Fully Invoiced',
  upselling: 'Upselling Opportunity',
}

/**
 * Odoo-style invoice status for a sale order. Quotations are always
 * "Nothing to Invoice"; a confirmed order is "To Invoice" as soon as any line
 * has an invoiceable quantity, "Fully Invoiced" when every expected quantity
 * has been invoiced, and "Upselling Opportunity" when more was delivered than
 * ordered on a fully invoiced order.
 */
export function saleOrderInvoiceStatus(
  status: OdooSaleStatus,
  lines: readonly InvoiceableLine[],
): SoInvoiceStatus {
  if (status !== 'sale') return 'no'
  const real = lines.filter(l => (Number(l.qty) || 0) > 0 || (Number(l.qtyDelivered) || 0) > 0)
  if (real.length === 0) return 'no'
  if (real.some(l => invoiceableQty(l) > 0)) return 'to_invoice'
  const anyInvoiced = real.some(l => (Number(l.qtyInvoiced) || 0) > 0)
  const allExpectZero = real.every(l => {
    const policy: InvoicePolicy = l.invoicePolicy === 'delivery' ? 'delivery' : 'order'
    const expected = policy === 'delivery' ? (Number(l.qtyDelivered) || 0) : (Number(l.qty) || 0)
    return expected === 0
  })
  if (!anyInvoiced && allExpectZero) return 'no'
  const overDelivered = real.some(l => (Number(l.qtyDelivered) || 0) > (Number(l.qty) || 0))
  return overDelivered ? 'upselling' : 'invoiced'
}

// ─── Delivery states ─────────────────────────────────────────────────────────

export type DeliveryState = 'draft' | 'waiting' | 'ready' | 'done' | 'cancelled'

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  draft: 'Draft',
  waiting: 'Waiting',
  ready: 'Ready',
  done: 'Done',
  cancelled: 'Cancelled',
}

export function normalizeDeliveryStatus(raw: unknown): DeliveryState {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (['draft', 'waiting', 'ready', 'done', 'cancelled'].includes(s)) return s as DeliveryState
  if (s === 'pending') return 'waiting'
  return 'ready'
}

/**
 * Odoo-style initial state for a delivery created at confirmation: Ready when
 * every line can be reserved from stock, Waiting when any line is short (the
 * delivery waits for availability, e.g. a backorder or an approved oversell).
 */
export function initialDeliveryState(hasShortfall: boolean): DeliveryState {
  return hasShortfall ? 'waiting' : 'ready'
}

export interface DeliverySplitLine {
  productId: string
  productName: string
  qty: number
  qtyDone: number
  serialIds: string[]
  sourceLocation?: string
}

/**
 * Split a delivery being validated into the quantities actually done and the
 * remainder that must move to a backorder. Quantities done are clamped to the
 * ordered quantity; negative input counts as zero.
 */
export function splitDeliveryForBackorder(
  lines: readonly DeliverySplitLine[],
  qtysDone: Readonly<Record<string, number>>,
): { doneLines: DeliverySplitLine[]; backorderLines: DeliverySplitLine[] } {
  const doneLines: DeliverySplitLine[] = []
  const backorderLines: DeliverySplitLine[] = []
  for (const line of lines) {
    const requested = qtysDone[line.productId]
    const done = Math.max(0, Math.min(Number(requested ?? line.qty) || 0, line.qty))
    if (done > 0) doneLines.push({ ...line, qty: done, qtyDone: done })
    const remaining = line.qty - done
    if (remaining > 0) backorderLines.push({ ...line, qty: remaining, qtyDone: 0, serialIds: [] })
  }
  return { doneLines, backorderLines }
}

// ─── Invoice document state & payment status ─────────────────────────────────

export type InvoiceDocState = 'draft' | 'posted' | 'cancelled'

export const INVOICE_DOC_STATE_LABELS: Record<InvoiceDocState, string> = {
  draft: 'Draft',
  posted: 'Posted',
  cancelled: 'Cancelled',
}

/**
 * The stored invoice status historically mixed the document state with the
 * payment progress ("partially_paid", "paid", "overdue"). The document state
 * is the Odoo-style projection: anything that has been validated is Posted.
 */
export function invoiceDocState(status: unknown): InvoiceDocState {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'cancelled':
    case 'voided':
      return 'cancelled'
    default:
      return 'posted'
  }
}

export type PaymentStatus = 'not_paid' | 'in_payment' | 'partially_paid' | 'paid' | 'reversed' | 'blocked'

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_paid: 'Not Paid',
  in_payment: 'In Payment',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  reversed: 'Reversed',
  blocked: 'Blocked',
}

export interface PaymentStatusInput {
  status: unknown
  total: number
  amountPaid: number
  /** Registered payments; `cleared === false` marks an uncleared instrument. */
  payments?: readonly { amount: number; cleared?: boolean }[]
  /** Finance dispute flag — payment collection is blocked until released. */
  paymentBlocked?: boolean
}

/** Outstanding balance on an invoice. */
export function invoiceResidual(inv: { total: number; amountPaid: number }): number {
  return Math.max(0, (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0))
}

/** A posted invoice that still carries a residual balance (open AR/AP item). */
export function isOpenInvoice(inv: { status: unknown; total: number; amountPaid: number }): boolean {
  return invoiceDocState(inv.status) === 'posted' && invoiceResidual(inv) > 0
}

/**
 * Server-computed payment status. Users never pick this: it is derived from
 * the registered/reconciled payments, the residual balance, and the finance
 * dispute flag (Blocked).
 */
export function invoicePaymentStatus(inv: PaymentStatusInput): PaymentStatus {
  const total = Number(inv.total) || 0
  const paid = Number(inv.amountPaid) || 0
  if (invoiceDocState(inv.status) === 'cancelled') {
    return paid > 0 ? 'reversed' : 'not_paid'
  }
  if (inv.paymentBlocked && paid < total) return 'blocked'
  if (paid <= 0) return 'not_paid'
  const uncleared = (inv.payments ?? []).some(p => p.cleared === false)
  if (paid >= total) return uncleared ? 'in_payment' : 'paid'
  return 'partially_paid'
}

/**
 * Overdue is a computed badge/filter, never a stored document state:
 * a posted invoice past its due date with a residual balance.
 */
export function isInvoiceOverdue(
  inv: { status: unknown; total: number; amountPaid: number; dueDate?: string },
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (invoiceDocState(inv.status) !== 'posted') return false
  if (!inv.dueDate) return false
  const residual = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0)
  return residual > 0 && inv.dueDate.slice(0, 10) < today
}

// ─── Cancellation guards ─────────────────────────────────────────────────────

export interface CancelGuardInput {
  status: OdooSaleStatus
  deliveries: readonly { status: string }[]
  invoices: readonly { status: unknown; amountPaid: number }[]
}

/**
 * A quotation may always be cancelled. A confirmed sales order with completed
 * deliveries, posted invoices or reconciled payments must have those records
 * reversed first — dependent records are never silently cancelled.
 */
export function saleOrderCancelBlockers(input: CancelGuardInput): string[] {
  const blockers: string[] = []
  if (isQuotationStage(input.status) || input.status === 'cancelled') return blockers
  const doneDeliveries = input.deliveries.filter(d => normalizeDeliveryStatus(d.status) === 'done').length
  if (doneDeliveries > 0) {
    blockers.push(`${doneDeliveries} completed ${doneDeliveries === 1 ? 'delivery' : 'deliveries'} — return the stock first`)
  }
  const activeInvoices = input.invoices.filter(i => invoiceDocState(i.status) !== 'cancelled')
  const postedInvoices = activeInvoices.filter(i => invoiceDocState(i.status) === 'posted')
  if (postedInvoices.length > 0) {
    blockers.push(`${postedInvoices.length} posted ${postedInvoices.length === 1 ? 'invoice' : 'invoices'} — issue a credit note or reset to draft first`)
  }
  const paidInvoices = activeInvoices.filter(i => (Number(i.amountPaid) || 0) > 0)
  if (paidInvoices.length > 0) {
    blockers.push(`payments registered on ${paidInvoices.length} ${paidInvoices.length === 1 ? 'invoice' : 'invoices'} — reverse the payments first`)
  }
  return blockers
}

// ─── List filters ────────────────────────────────────────────────────────────

export type SalesListFilter =
  | 'all'
  | 'my_quotations'
  | 'quotations'
  | 'quotation_sent'
  | 'sales_orders'
  | 'cancelled'
  | 'to_invoice'
  | 'fully_invoiced'

export const SALES_LIST_FILTER_LABELS: Record<SalesListFilter, string> = {
  all: 'All',
  my_quotations: 'My Quotations',
  quotations: 'Quotations',
  quotation_sent: 'Quotation Sent',
  sales_orders: 'Sales Orders',
  cancelled: 'Cancelled',
  to_invoice: 'To Invoice',
  fully_invoiced: 'Fully Invoiced',
}

export interface FilterableSaleOrder {
  status: OdooSaleStatus
  createdByUserId?: string
  createdById?: string
  lines: readonly InvoiceableLine[]
}

export function matchesSalesListFilter(
  so: FilterableSaleOrder,
  filter: SalesListFilter,
  currentUserId?: string | null,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'my_quotations':
      return isQuotationStage(so.status) &&
        !!currentUserId && (so.createdByUserId === currentUserId || so.createdById === currentUserId)
    case 'quotations':
      return isQuotationStage(so.status)
    case 'quotation_sent':
      return so.status === 'quotation_sent'
    case 'sales_orders':
      return so.status === 'sale'
    case 'cancelled':
      return so.status === 'cancelled'
    case 'to_invoice':
      return saleOrderInvoiceStatus(so.status, so.lines) === 'to_invoice'
    case 'fully_invoiced': {
      const s = saleOrderInvoiceStatus(so.status, so.lines)
      return s === 'invoiced' || s === 'upselling'
    }
    default:
      return true
  }
}

// ─── Client-side record normalization ────────────────────────────────────────

/**
 * Normalize a sale order loaded from the API, the store sync stream, or old
 * localStorage snapshots onto the Odoo vocabulary without losing any data.
 * Legacy approval statuses become the approval flag; legacy fulfilment
 * statuses collapse to "sale" (their progress already lives on qtyDelivered
 * and the linked invoices).
 */
export function normalizeSaleOrderForClient<T extends { status?: unknown; approvalStatus?: unknown }>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw
  const status = normalizeSaleStatus(raw.status)
  const impliedApproval = legacyApprovalFromStatus(raw.status)
  return {
    ...raw,
    status,
    ...(impliedApproval && !raw.approvalStatus ? { approvalStatus: impliedApproval } : {}),
  }
}

export function normalizeSaleOrdersForClient<T extends { status?: unknown }>(rows: T[]): T[] {
  return Array.isArray(rows) ? rows.map(r => normalizeSaleOrderForClient(r as any)) : []
}
