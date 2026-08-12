/** Shared money / residual helpers for accounting (no server imports). */

export function roundMoney(n: unknown): number {
  return Math.round(Number(n || 0) * 100) / 100
}

/** Invoice residual from total − non-void allocations (never negative). */
export function invoiceResidual(totalAmount: number, allocatedAmount: number): number {
  return Math.max(0, roundMoney(Number(totalAmount) - Number(allocatedAmount)))
}
