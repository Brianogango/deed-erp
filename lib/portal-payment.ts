// Shared portal payment helpers for quote-revision / prior-payment edge cases.
// Pure functions — safe for client and server.

import type { PortalPaymentStatus } from './portal-repairs'

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** True when the customer must re-approve a revised quote. */
export function isAwaitingQuoteRevision(opts: {
  status?: string | null
  changeSummary?: string | null
}): boolean {
  return opts.status === 'awaiting_approval' && !!opts.changeSummary?.trim()
}

/**
 * Map ERP payment confirmation + invoice paid amount into a portal paymentStatus.
 * While a revised quote awaits re-approval, never surface as paid/auto_paid so the
 * portal does not show a conflicting "Payment confirmed" CTA next to approval.
 */
export function resolvePortalPaymentStatus(opts: {
  status?: string | null
  changeSummary?: string | null
  paymentConfirmationStatus?: string | null
  invoiceAmountPaid?: number | null
  invoiceTotal?: number | null
}): PortalPaymentStatus {
  const confirmation = opts.paymentConfirmationStatus ?? undefined
  const awaitingRevision = isAwaitingQuoteRevision(opts)

  if (awaitingRevision) {
    if (confirmation === 'pending_review') return 'pending_review'
    if (confirmation === 'rejected') return 'rejected'
    return 'unpaid'
  }

  if (confirmation === 'auto_paid') return 'auto_paid'
  if (confirmation === 'confirmed') return 'paid'
  if (confirmation === 'pending_review') return 'pending_review'
  if (confirmation === 'rejected') return 'rejected'
  if (confirmation === 'unpaid') return 'unpaid'

  const paid = Number(opts.invoiceAmountPaid ?? 0)
  const total = Number(opts.invoiceTotal ?? 0)
  if (total > 0 && paid >= total) return 'paid'
  return 'unpaid'
}

/** Amount still owed after applying prior payments to the current invoice/quote total. */
export function residualAmountDue(invoiceOrQuoteTotal: number, amountPaid: number): number {
  return Math.max(0, roundMoney(invoiceOrQuoteTotal) - roundMoney(amountPaid))
}

/**
 * After a customer re-approves a revised quote, decide whether prior payment
 * still covers the new total (keep confirmed) or a residual remains (unpaid).
 */
export function settlementAfterReapproval(opts: {
  approvedTotal: number
  amountPaid: number
  priorConfirmationStatus?: string | null
}): {
  residualDue: number
  creditBalance: number
  nextConfirmationStatus: 'confirmed' | 'auto_paid' | 'unpaid' | 'pending_review' | 'rejected' | undefined
  fullyCovered: boolean
} {
  const approvedTotal = roundMoney(opts.approvedTotal)
  const amountPaid = roundMoney(opts.amountPaid)
  const residualDue = residualAmountDue(approvedTotal, amountPaid)
  const creditBalance = Math.max(0, amountPaid - approvedTotal)
  const fullyCovered = residualDue <= 0 && amountPaid > 0

  const prior = opts.priorConfirmationStatus
  if (prior === 'pending_review') {
    return { residualDue, creditBalance, nextConfirmationStatus: 'pending_review', fullyCovered }
  }
  if (prior === 'rejected' && !fullyCovered) {
    return { residualDue, creditBalance, nextConfirmationStatus: 'rejected', fullyCovered }
  }
  if (fullyCovered) {
    const next = prior === 'auto_paid' ? 'auto_paid' : 'confirmed'
    return { residualDue: 0, creditBalance, nextConfirmationStatus: next, fullyCovered: true }
  }
  if (amountPaid > 0) {
    // Prior payment retained as credit against the new total — ask for residual only.
    return { residualDue, creditBalance: 0, nextConfirmationStatus: 'unpaid', fullyCovered: false }
  }
  return { residualDue, creditBalance: 0, nextConfirmationStatus: undefined, fullyCovered: false }
}
