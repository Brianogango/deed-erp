/**
 * Odoo-style down-payment helpers for Sale Orders.
 *
 * Down-payment invoices do NOT bump product qtyInvoiced. They record a
 * deposit against the SO; the final invoice deducts prior downs.
 */

export type CreateInvoiceMode =
  | 'regular'
  | 'down_payment_percent'
  | 'down_payment_fixed'
  | 'final'

export function normalizeCreateInvoiceMode(raw: unknown): CreateInvoiceMode {
  const value = String(raw ?? 'regular').trim().toLowerCase()
  if (value === 'down_payment_percent' || value === 'downpayment_percent' || value === 'deposit_percent') {
    return 'down_payment_percent'
  }
  if (value === 'down_payment_fixed' || value === 'downpayment_fixed' || value === 'deposit_fixed') {
    return 'down_payment_fixed'
  }
  if (value === 'final' || value === 'balance' || value === 'final_invoice') return 'final'
  return 'regular'
}

export function isDownPaymentMode(mode: CreateInvoiceMode): boolean {
  return mode === 'down_payment_percent' || mode === 'down_payment_fixed'
}

/** Order total used as the down-payment base (tax-inclusive commercial total). */
export function saleOrderDownPaymentBase(order: {
  totalAmount?: unknown
  total?: unknown
  subtotal?: unknown
  taxAmount?: unknown
  taxTotal?: unknown
  discountAmount?: unknown
}): number {
  const explicit = Number(order.totalAmount ?? order.total)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit)
  const sub = Number(order.subtotal) || 0
  const tax = Number(order.taxAmount ?? order.taxTotal) || 0
  const disc = Number(order.discountAmount) || 0
  return Math.max(0, Math.round(sub + tax - disc))
}

export function computeDownPaymentAmount(opts: {
  mode: CreateInvoiceMode
  orderTotal: number
  percent?: unknown
  amount?: unknown
  /** Already invoiced as down payments (draft or posted), not yet applied to a final invoice. */
  priorDownPayments?: number
}): { ok: true; amount: number; percent: number | null } | { ok: false; error: string } {
  const orderTotal = Math.max(0, Math.round(Number(opts.orderTotal) || 0))
  const prior = Math.max(0, Math.round(Number(opts.priorDownPayments) || 0))
  const remaining = Math.max(0, orderTotal - prior)
  if (remaining < 1) {
    return { ok: false, error: 'No remaining balance available for a down payment' }
  }

  if (opts.mode === 'down_payment_percent') {
    const percent = Number(opts.percent)
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { ok: false, error: 'Down payment percent must be between 0 and 100' }
    }
    const amount = Math.min(remaining, Math.max(1, Math.round((orderTotal * percent) / 100)))
    return { ok: true, amount, percent }
  }

  if (opts.mode === 'down_payment_fixed') {
    const amount = Math.round(Number(opts.amount) || 0)
    if (amount < 1) return { ok: false, error: 'Down payment amount must be at least KES 1' }
    if (amount > remaining) {
      return { ok: false, error: `Down payment cannot exceed remaining balance of KES ${remaining.toLocaleString()}` }
    }
    const percent = orderTotal > 0 ? Math.round((amount / orderTotal) * 10000) / 100 : null
    return { ok: true, amount, percent }
  }

  return { ok: false, error: 'Not a down-payment mode' }
}

export interface DownPaymentInvoiceLike {
  id?: string
  saleOrderId?: string | null
  status?: string | null
  total?: number | null
  totalAmount?: number | null
  isDownPayment?: boolean | null
  downPaymentAppliedToId?: string | null
  notes?: string | null
  subject?: string | null
}

/** True when an invoice row is an unapplied down payment for the given SO. */
export function isUnappliedDownPayment(
  invoice: DownPaymentInvoiceLike,
  saleOrderId: string,
): boolean {
  if (!invoice || String(invoice.saleOrderId ?? '') !== saleOrderId) return false
  const status = String(invoice.status ?? '').toLowerCase()
  if (status === 'cancelled' || status === 'canceled' || status === 'rejected') return false
  if (invoice.downPaymentAppliedToId) return false
  if (invoice.isDownPayment === true) return true
  const marker = `${invoice.notes ?? ''} ${invoice.subject ?? ''}`
  return /\[Down Payment/i.test(marker) && !/\[Down payment applied/i.test(marker)
}

export function sumUnappliedDownPayments(
  invoices: readonly DownPaymentInvoiceLike[],
  saleOrderId: string,
): number {
  return invoices.reduce((sum, inv) => {
    if (!isUnappliedDownPayment(inv, saleOrderId)) return sum
    const total = Number(inv.totalAmount ?? inv.total) || 0
    return sum + Math.max(0, Math.round(total))
  }, 0)
}

/** Cap the final-invoice deduction so the invoice never goes negative. */
export function downPaymentDeductionForFinal(opts: {
  invoiceSubtotal: number
  invoiceTax: number
  headerDiscount?: number
  priorDownPayments: number
}): number {
  const pretaxNet = Math.max(0, (Number(opts.invoiceSubtotal) || 0) + (Number(opts.invoiceTax) || 0) - (Number(opts.headerDiscount) || 0))
  return Math.min(pretaxNet, Math.max(0, Math.round(Number(opts.priorDownPayments) || 0)))
}
