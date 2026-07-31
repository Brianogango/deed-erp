import { describe, expect, it } from 'vitest'
import { round2, validateAllocationTotals } from '@/lib/accounting/payment-allocations'

describe('payment allocation math', () => {
  it('rounds to two decimal places', () => {
    expect(round2(99.999)).toBe(100)
    expect(round2(50.555)).toBe(50.56)
  })

  it('rejects allocations exceeding payment amount', () => {
    const residuals = new Map([['inv-1', 5000], ['inv-2', 3000]])
    const result = validateAllocationTotals(6000, [
      { invoiceId: 'inv-1', amount: 4000 },
      { invoiceId: 'inv-2', amount: 3000 },
    ], residuals)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('exceed payment amount')
  })

  it('rejects allocation exceeding invoice residual', () => {
    const residuals = new Map([['inv-1', 1000]])
    const result = validateAllocationTotals(1500, [
      { invoiceId: 'inv-1', amount: 1500 },
    ], residuals)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('exceeds residual')
  })

  it('accepts valid multi-invoice allocations', () => {
    const residuals = new Map([['inv-1', 5000], ['inv-2', 3000]])
    const result = validateAllocationTotals(6000, [
      { invoiceId: 'inv-1', amount: 4000 },
      { invoiceId: 'inv-2', amount: 2000 },
    ], residuals)
    expect(result).toEqual({ ok: true })
  })

  it('requires at least one positive allocation', () => {
    const result = validateAllocationTotals(1000, [], new Map())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('At least one')
  })
})
