/**
 * Residual / outstanding helpers (Finance Phase 2).
 *
 * Invoice payment progress stays derived (see lib/odoo-sales-flow invoicePaymentStatus).
 * Payment "outstanding" = unallocated cash still on the receipt/payment.
 */

import { invoiceResidual, roundMoney } from '@/lib/accounting/money'

export { invoiceResidual, roundMoney }

export type PaymentAllocationState =
  | 'unallocated'
  | 'partial'
  | 'fully_allocated'
  | 'void'

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

export function paymentAllocationState(params: {
  amount: number
  allocatedSum: number
  isVoided?: boolean
}): PaymentAllocationState {
  if (params.isVoided) return 'void'
  const amount = roundMoney(params.amount)
  const allocated = roundMoney(params.allocatedSum)
  if (allocated <= 0.009) return 'unallocated'
  if (allocated + 0.009 >= amount) return 'fully_allocated'
  return 'partial'
}

export function isOutstandingPayment(params: {
  amount: number
  allocatedSum: number
  isVoided?: boolean
}): boolean {
  if (params.isVoided) return false
  return paymentUnallocated(params.amount, params.allocatedSum) > 0.009
}

/** Invoice open balance — alias kept for ageing / AR lists. */
export function invoiceOpenResidual(total: number, amountPaid: number): number {
  return invoiceResidual(total, amountPaid)
}
