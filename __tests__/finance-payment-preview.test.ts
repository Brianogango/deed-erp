import { describe, expect, it } from 'vitest'
import { financePaymentPreview } from '@/lib/finance-payment-preview'

describe('financePaymentPreview', () => {
  it('shows a partial payment without changing the entered value', () => {
    expect(financePaymentPreview('400', 1_000)).toEqual({
      entered: 400,
      applied: 400,
      balanceBefore: 1_000,
      balanceAfter: 600,
      isValid: true,
      isOverpayment: false,
      fullySettles: false,
    })
  })

  it('caps overpayments at the outstanding balance', () => {
    const result = financePaymentPreview(1_500, 1_000)
    expect(result.applied).toBe(1_000)
    expect(result.balanceAfter).toBe(0)
    expect(result.isOverpayment).toBe(true)
    expect(result.fullySettles).toBe(true)
  })

  it('rejects invalid and non-positive values', () => {
    expect(financePaymentPreview('not-a-number', 1_000).isValid).toBe(false)
    expect(financePaymentPreview(-100, 1_000).applied).toBe(0)
    expect(financePaymentPreview(100, 0).isValid).toBe(false)
  })
})
