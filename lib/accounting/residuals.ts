/**
 * Residual / outstanding helpers (Finance Phase 2).
 *
 * Invoice payment progress stays derived (see lib/odoo-sales-flow invoicePaymentStatus).
 * Payment "outstanding" = unallocated cash still on the receipt/payment.
 */

import { roundMoney } from '@/lib/accounting/money'

export function paymentAllocatedSum(
  allocations: ReadonlyArray<{ amount: number }>,
): number {
  return roundMoney(allocations.reduce((s, a) => s + Number(a.amount || 0), 0))
}

/** Cash on a receipt/payment not yet applied to invoices/bills. */
export function paymentUnallocated(
  paymentAmount: number,
  allocatedSum: number,
): number {
  return Math.max(0, roundMoney(Number(paymentAmount) - Number(allocatedSum)))
}

