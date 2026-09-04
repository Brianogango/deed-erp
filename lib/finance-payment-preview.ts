export type FinancePaymentPreview = {
  entered: number
  applied: number
  balanceBefore: number
  balanceAfter: number
  isValid: boolean
  isOverpayment: boolean
  fullySettles: boolean
}

/**
 * Produces the amount that may safely be applied to an invoice or vendor bill.
 * UI callers and payment handlers use the same capped value so the preview
 * cannot disagree with the stored payment.
 */
export function financePaymentPreview(
  enteredValue: string | number,
  outstandingBalance: number,
): FinancePaymentPreview {
  const parsed = typeof enteredValue === 'number' ? enteredValue : Number(enteredValue)
  const entered = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  const balanceBefore = Number.isFinite(outstandingBalance) ? Math.max(0, outstandingBalance) : 0
  const applied = Math.min(entered, balanceBefore)

  return {
    entered,
    applied,
    balanceBefore,
    balanceAfter: Math.max(0, balanceBefore - applied),
    isValid: entered > 0 && balanceBefore > 0,
    isOverpayment: entered > balanceBefore,
    fullySettles: applied > 0 && applied >= balanceBefore,
  }
}
