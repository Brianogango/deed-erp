import { describe, it, expect } from 'vitest'
import { computeInvoiceTotals, clampAmountPaid } from '@/lib/finance-invoice'

describe('computeInvoiceTotals', () => {
  it('derives subtotal from qty × unitPrice, ignoring client-supplied line subtotals', () => {
    const totals = computeInvoiceTotals([
      { qty: 2, unitPrice: 100, subtotal: 999999 },
      { qty: 1, unitPrice: 50, subtotal: 0 },
    ])
    expect(totals.subtotal).toBe(250)
    expect(totals.totalAmount).toBe(250)
  })

  it('computes per-line tax from tax rates', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 1000, taxRate: 16 }])
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('falls back to header tax when lines carry no rate (POS/repair VAT pattern)', () => {
    const totals = computeInvoiceTotals(
      [{ qty: 1, unitPrice: 1000, taxRate: 0 }],
      { headerTax: 160 },
    )
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('applies discount and never returns a negative total', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 100 }], { discount: 500 })
    expect(totals.totalAmount).toBe(0)
    expect(totals.discountAmount).toBe(500)
  })

  it('handles an empty / non-array line set safely', () => {
    expect(computeInvoiceTotals([]).totalAmount).toBe(0)
    // @ts-expect-error — defensive against malformed payloads
    expect(computeInvoiceTotals(undefined).totalAmount).toBe(0)
  })
})

describe('clampAmountPaid', () => {
  it('clamps into [0, totalAmount]', () => {
    expect(clampAmountPaid(999, 500)).toBe(500)
    expect(clampAmountPaid(-10, 500)).toBe(0)
    expect(clampAmountPaid(250, 500)).toBe(250)
  })
})
