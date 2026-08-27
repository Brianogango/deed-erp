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

/** Draft quotation only — sent quotations must be reset before editing. */
export function isQuotationDraft(status: OdooSaleStatus): boolean {
  return status === 'quotation'
}

/**
 * True when the order is already a Sales Order, or when durable confirmation
 * evidence exists even if `status` drifted back to a quotation stage.
 *
 * Client confirm uses fire-and-forget sync; the UI can show SO/… + confirmed
 * while Prisma still has quotation. Delivery / invoice APIs use this to heal.
 */
export function saleOrderLooksConfirmed(order: {
  status?: unknown
  confirmedAt?: unknown
  orderNumber?: unknown
  ref?: unknown
}): boolean {
  const status = normalizeSaleStatus(order.status)
  if (status === 'sale') return true
  if (status === 'cancelled') return false
  if (order.confirmedAt) return true
  const num = String(order.orderNumber ?? order.ref ?? '').trim()
  // Confirmed orders use the SO sequence; quotations use SQ/QUO.
  return /^SO[/\\-]/i.test(num)
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
  opts?: { previouslyConfirmed?: boolean },
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
      // Quotations may always be cancelled. Cancelling a confirmed Sales
      // Order reverses a commercial document, same as "Set to Quotation",
      // so it requires the same Finance/Director gate. Dependent-record
      // blockers (completed deliveries, posted invoices) are checked
      // separately by the caller.
      if (from === 'sale' && !['director', 'finance_officer'].includes(role)) {
        return 'Only Finance or Director can cancel a confirmed Sales Order'
      }
      return null
    case 'quotation':
      // "Set to Quotation" from a confirmed SO requires Finance/Director
      // (matches enforceSaleWorkflow + store resetSOToDraft). Cancelled orders
      // that were previously confirmed use the same gate; draft/sent cancel
      // → quotation stays available to sales staff.
      if (from === 'sale' && !['director', 'finance_officer'].includes(role)) {
        return 'Only Finance or Director can reset a sale order to quotation'
      }
      if (
        from === 'cancelled' &&
        opts?.previouslyConfirmed &&
        !['director', 'finance_officer'].includes(role)
      ) {
        return 'Only Finance or Director can reset a previously confirmed order to quotation'
      }
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
  /** False for services / unlinked labour — they are not warehouse demand. */
  needsDelivery?: boolean
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

export type SoFulfilmentStatus = 'nothing' | 'to_deliver' | 'partial' | 'delivered'

export const SO_FULFILMENT_STATUS_LABELS: Record<SoFulfilmentStatus, string> = {
  nothing: 'Nothing to Deliver',
  to_deliver: 'Waiting Delivery',
  partial: 'Partially Delivered',
  delivered: 'Fully Delivered',
}

/** Fulfilment progress from validated delivered quantities (independent of payment). */
export function saleOrderFulfilmentStatus(
  status: OdooSaleStatus,
  lines: readonly InvoiceableLine[],
): SoFulfilmentStatus {
  if (status !== 'sale') return 'nothing'
  const real = lines.filter(l => (Number(l.qty) || 0) > 0 && l.needsDelivery !== false)
  if (real.length === 0) return 'nothing'
  const ordered = real.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const delivered = real.reduce((s, l) => s + Math.min(Number(l.qty) || 0, Number(l.qtyDelivered) || 0), 0)
  if (delivered <= 0) return 'to_deliver'
  if (delivered < ordered) return 'partial'
  return 'delivered'
}

/**
 * Operational completion: confirmed SO, every ordered qty delivered (or
 * non-deliverable), and every line fully invoiced per its policy.
 * Payment remains a separate dimension — cash sales may still show unpaid.
 */
export function saleOrderIsOperationallyComplete(
  status: OdooSaleStatus,
  lines: readonly InvoiceableLine[],
): boolean {
  if (status !== 'sale') return false
  const real = lines.filter(l => (Number(l.qty) || 0) > 0)
  if (real.length === 0) return false
  const deliverable = real.filter(l => l.needsDelivery !== false)
  const fulfilment = deliverable.length === 0 ? 'delivered' : saleOrderFulfilmentStatus(status, real)
  if (fulfilment !== 'delivered' && fulfilment !== 'nothing') return false
  return saleOrderInvoiceStatus(status, real) === 'invoiced' || saleOrderInvoiceStatus(status, real) === 'upselling'
}

/** True when a quotation has a durable customer-acceptance stamp. */
export function saleOrderIsAccepted(order: {
  acceptedAt?: unknown
  notes?: unknown
}): boolean {
  if (order.acceptedAt) return true
  const notes = String(order.notes ?? '')
  return /\[Customer accepted/i.test(notes)
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

/** Open pickings that still need prepare/validate (not Done / Cancelled). */
export function isOpenDeliveryStatus(status: unknown): boolean {
  const s = normalizeDeliveryStatus(status)
  return s === 'draft' || s === 'waiting' || s === 'ready'
}

/**
 * True when the order is still confirmed and every linked picking is
 * cancelled (or there is none). Used so Create delivery mints a replacement
 * DN instead of reopening the cancelled one.
 */
export function shouldReplaceCancelledDelivery(opts: {
  soStatus?: string | null
  deliveries?: { status?: string }[] | null
}): boolean {
  if (String(opts.soStatus ?? '') === 'cancelled') return false
  if (opts.soStatus !== 'sale') return false
  const linked = opts.deliveries ?? []
  if (linked.some(d => isOpenDeliveryStatus(d.status))) return false
  if (linked.length === 0) return true
  return linked.every(d => normalizeDeliveryStatus(d.status) === 'cancelled')
}

/** Deliveries linked to an SO; cancelled excluded unless requested. */
export function deliveriesForSaleOrder<T extends { saleOrderId?: string; status?: string }>(
  deliveries: T[] | null | undefined,
  saleOrderId: string,
  opts?: { includeCancelled?: boolean },
): T[] {
  return (deliveries ?? []).filter(d => {
    if (d.saleOrderId !== saleOrderId) return false
    if (opts?.includeCancelled) return true
    return normalizeDeliveryStatus(d.status) !== 'cancelled'
  })
}

/**
 * Remaining undelivered qty per product on a Sales Order (ordered − qtyDelivered).
 * Section lines are ignored. Used to refuse duplicate DNs / empty backorders.
 */
export function remainingUndeliveredByProduct(
  lines: Array<{
    productId?: string
    qty?: number
    qtyDelivered?: number
    lineType?: string
    unit?: string
  }> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines ?? []) {
    if (line.lineType === 'section' || line.lineType === 'service' || !line.productId) continue
    if (String(line.unit ?? '').toLowerCase() === 'service') continue
    const demand = Math.max(0, Number(line.qty) || 0)
    const delivered = Math.max(0, Number(line.qtyDelivered) || 0)
    const remaining = Math.max(0, demand - delivered)
    out[line.productId] = (out[line.productId] ?? 0) + remaining
  }
  return out
}

/** Total open (waiting/ready/draft) demand per product across pickings for an SO. */
export function openDeliveryDemandByProduct(
  deliveries: Array<{
    saleOrderId?: string
    status?: string
    lines?: Array<{ productId?: string; qty?: number }> | null
  }> | null | undefined,
  saleOrderId: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const delivery of deliveries ?? []) {
    if (delivery.saleOrderId !== saleOrderId) continue
    if (!isOpenDeliveryStatus(delivery.status)) continue
    for (const line of delivery.lines ?? []) {
      if (!line.productId) continue
      out[line.productId] = (out[line.productId] ?? 0) + Math.max(0, Number(line.qty) || 0)
    }
  }
  return out
}

/**
 * Odoo-style initial state for a delivery created at confirmation: Ready when
 * every line can be reserved from stock, Waiting when any line is short (the
 * delivery waits for availability, e.g. a backorder or an approved oversell).
 */
export function initialDeliveryState(hasShortfall: boolean): DeliveryState {
  return hasShortfall ? 'waiting' : 'ready'
}

/**
 * True when a completed Delivery Note document was generated for the SO
 * (print/generate stamp). Kept for DN UI; invoicing uses
 * {@link hasValidatedDeliveryForInvoice} instead.
 */
export function hasGeneratedDeliveryNote(
  deliveries: Array<{
    saleOrderId?: string
    status?: string
    deliveryNoteGeneratedAt?: string | null
    lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
  }> | null | undefined,
  saleOrderId: string,
): boolean {
  return (deliveries ?? []).some(delivery =>
    delivery.saleOrderId === saleOrderId &&
    delivery.status === 'done' &&
    Boolean(delivery.deliveryNoteGeneratedAt) &&
    deliveryDeliveredTotal(delivery) > 0,
  )
}

/**
 * A Sales Order can invoice once a delivery is validated (Done) with a
 * positive delivered quantity. Printing the Delivery Note is optional.
 * A hollow Done delivery (Delivered=0, no serials) must never unlock invoicing.
 */
export function hasValidatedDeliveryForInvoice(
  deliveries: Array<{
    saleOrderId?: string
    status?: string
    lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
  }> | null | undefined,
  saleOrderId: string,
): boolean {
  return (deliveries ?? []).some(delivery =>
    delivery.saleOrderId === saleOrderId &&
    delivery.status === 'done' &&
    deliveryDeliveredTotal(delivery) > 0,
  )
}

/** True when a delivery is Done (or about to be) but effective delivered qty is 0. */
export function isHollowDoneDelivery(delivery: {
  status?: string
  lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
} | null | undefined): boolean {
  if (!delivery) return false
  if (normalizeDeliveryStatus(delivery.status) !== 'done') return false
  return deliveryDeliveredTotal(delivery) <= 0
}

/**
 * Whether the UI/API may treat this delivery as eligible for Generate/Print DN.
 * Requires Done + positive effective delivered qty.
 */
export function canGenerateDeliveryNote(delivery: {
  status?: string
  lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
} | null | undefined): boolean {
  if (!delivery) return false
  return normalizeDeliveryStatus(delivery.status) === 'done' && deliveryDeliveredTotal(delivery) > 0
}

/**
 * Server/client guard: reject Done status or DN stamp when nothing was delivered.
 * Returns an error message, or null when the write is allowed.
 */
export function deliveryFulfillmentWriteError(next: {
  status?: string
  preparedAt?: string | null
  deliveryNoteGeneratedAt?: string | null
  lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
}, previous?: {
  status?: string
  preparedAt?: string | null
  deliveryNoteGeneratedAt?: string | null
  lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
} | null): string | null {
  const prevStatus = previous ? normalizeDeliveryStatus(previous.status) : 'draft'
  const nextStatus = normalizeDeliveryStatus(next.status ?? previous?.status)
  const lines = next.lines ?? previous?.lines ?? []
  const delivered = deliveryDeliveredTotal({ lines })
  const stampingDn = Boolean(next.deliveryNoteGeneratedAt) &&
    !Boolean(previous?.deliveryNoteGeneratedAt)

  if (nextStatus === 'done' && delivered <= 0) {
    return 'Cannot mark delivery Done — delivered quantity is 0. Enter quantities or assign serials first.'
  }
  if (stampingDn && (nextStatus !== 'done' || delivered <= 0)) {
    return 'Cannot generate Delivery Note — delivery must be Done with delivered quantity > 0.'
  }
  // First transition to Done must come from a prepared Ready picking.
  if (prevStatus !== 'done' && nextStatus === 'done') {
    const preparedAt = next.preparedAt ?? previous?.preparedAt
    if (prevStatus !== 'ready' || !preparedAt) {
      return 'Prepare and reserve this delivery (Ready) before validating as Done'
    }
  }
  return null
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
 * Effective quantity delivered on a delivery line.
 * Prefer explicit qtyDone / requested qty; for serial-tracked lines fall back to
 * assigned serial count so a Done DN with serials can never leave delivered=0.
 */
export function effectiveDeliveryLineQty(line: {
  qty: number
  qtyDone?: number
  serialIds?: string[] | null
}, requested?: number): number {
  const demand = Math.max(0, Number(line.qty) || 0)
  const fromRequest = requested === undefined ? undefined : Math.max(0, Number(requested) || 0)
  const fromDone = Math.max(0, Number(line.qtyDone) || 0)
  const fromSerials = Array.isArray(line.serialIds) ? line.serialIds.length : 0
  const raw = Math.max(fromRequest ?? 0, fromDone, fromSerials)
  return Math.max(0, Math.min(raw, demand))
}

/**
 * Split a delivery being validated into the quantities actually done and the
 * remainder that must move to a backorder. Quantities done are clamped to the
 * ordered quantity; negative input counts as zero.
 *
 * When the requested map is 0/missing but the line already has serials (or a
 * prior qtyDone), those count as delivered so serial shipments cannot validate
 * as Done with Delivered=0.
 *
 * `qtysDone` is treated as a **per-product pool** consumed FIFO across duplicate
 * productId rows (same shape as prepare). A collapsed Object.fromEntries map
 * must not make every duplicate line read the last row's qty.
 */
export function splitDeliveryForBackorder(
  lines: readonly DeliverySplitLine[],
  qtysDone: Readonly<Record<string, number>> = {},
): {
  doneLines: DeliverySplitLine[]
  backorderLines: DeliverySplitLine[]
  /** Per-input-line done qty (same order as `lines`) — use this instead of `.find(productId)`. */
  lineDone: number[]
} {
  const pool: Record<string, number> = {}
  for (const [productId, raw] of Object.entries(qtysDone)) {
    pool[productId] = Math.max(0, Number(raw) || 0)
  }
  const doneLines: DeliverySplitLine[] = []
  const backorderLines: DeliverySplitLine[] = []
  const lineDone: number[] = []
  for (const line of lines) {
    const local = Math.max(Number(line.qtyDone) || 0, Array.isArray(line.serialIds) ? line.serialIds.length : 0)
    const hasPool = Object.prototype.hasOwnProperty.call(pool, line.productId)
    // Prefer what prepare stamped on THIS line; only draw from the product pool
    // when the line has no local done/serial signal yet.
    const override = local > 0
      ? local
      : hasPool
        ? pool[line.productId]
        : undefined
    const done = effectiveDeliveryLineQty(line, override)
    lineDone.push(done)
    if (hasPool) {
      pool[line.productId] = Math.max(0, (pool[line.productId] ?? 0) - done)
    }
    if (done > 0) {
      const serialIds = (line.serialIds ?? []).slice(0, done)
      doneLines.push({ ...line, qty: done, qtyDone: done, serialIds })
    }
    const remaining = line.qty - done
    if (remaining > 0) backorderLines.push({ ...line, qty: remaining, qtyDone: 0, serialIds: [] })
  }
  return { doneLines, backorderLines, lineDone }
}

/** Total delivered units on a delivery (qtyDone, falling back to serial count). */
export function deliveryDeliveredTotal(delivery: {
  lines?: Array<{ qty?: number; qtyDone?: number; serialIds?: string[] | null }> | null
}): number {
  return (delivery.lines ?? []).reduce(
    (sum, line) => sum + effectiveDeliveryLineQty({
      qty: Number(line.qty) || 0,
      qtyDone: line.qtyDone,
      serialIds: line.serialIds,
    }),
    0,
  )
}

/**
 * Sum effective delivered qty per productId from Done deliveries for an SO.
 * Used to heal Prisma `qtyDelivered` when a legacy Done DN left it at 0
 * despite assigned serials / qtyDone.
 */
export function deliveredByProductFromDoneDeliveries(
  deliveries: Array<{
    saleOrderId?: string
    status?: string
    lines?: Array<{
      productId?: string
      qty?: number
      qtyDone?: number
      serialIds?: string[] | null
    }> | null
  }> | null | undefined,
  saleOrderId: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const delivery of deliveries ?? []) {
    if (delivery.saleOrderId !== saleOrderId) continue
    if (normalizeDeliveryStatus(delivery.status) !== 'done') continue
    for (const line of delivery.lines ?? []) {
      if (!line.productId) continue
      const qty = effectiveDeliveryLineQty({
        qty: Number(line.qty) || 0,
        qtyDone: line.qtyDone,
        serialIds: line.serialIds,
      })
      if (qty <= 0) continue
      out[line.productId] = (out[line.productId] ?? 0) + qty
    }
  }
  return out
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

/**
 * Draft invoices carry a `DRAFT/INV/XXXXXXXX` placeholder until posting
 * assigns the official number (Odoo shows "/" on unposted invoices). Lists
 * and headers render the placeholder as a friendly Draft label instead.
 */
export function displayDocRef(ref: string | undefined | null): string {
  const value = String(ref ?? '')
  const match = /^DRAFT\/(INV|BILL)\/(.+)$/.exec(value)
  if (!match) return value
  return `Draft ${match[1] === 'BILL' ? 'Bill' : 'Invoice'} · ${match[2]}`
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
  inv: { status: unknown; total: number; amountPaid: number; dueDate?: string; date?: string },
  today: string = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }),
): boolean {
  if (invoiceDocState(inv.status) !== 'posted') return false
  const due = String(inv.dueDate || inv.date || '').slice(0, 10)
  if (!due) return false
  const residual = (Number(inv.total) || 0) - (Number(inv.amountPaid) || 0)
  return residual > 0 && due < today
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

/**
 * Quotations vs Orders tabs (Odoo same-document model).
 *
 * Quotations: unconfirmed commercial proposals (draft/sent), plus cancelled
 * quotes that were never confirmed.
 * Orders: confirmed sales (status sale) and cancelled records that already
 * carried confirmation evidence (confirmedAt / SO number). Never park an
 * SO/… cancelled row under Quotations just because confirmedAt is missing.
 */
export function matchesSalesListTab(
  so: {
    status?: unknown
    confirmedAt?: unknown
    orderNumber?: unknown
    ref?: unknown
  },
  tab: 'quotations' | 'orders',
): boolean {
  const status = normalizeSaleStatus(so.status)
  // saleOrderLooksConfirmed intentionally returns false for cancelled rows
  // (cancel is terminal). For list tabs we still need confirmation evidence:
  // confirmedAt and/or an SO/… number after the same document was confirmed.
  const number = String(so.orderNumber ?? so.ref ?? '').trim()
  const wasConfirmed = Boolean(so.confirmedAt) || /^SO[/\\-]/i.test(number)

  if (tab === 'quotations') {
    if (isQuotationStage(status)) return true
    // Cancelled before confirm only — never SO-numbered leftovers.
    return status === 'cancelled' && !wasConfirmed
  }
  if (status === 'sale') return true
  return status === 'cancelled' && wasConfirmed
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
