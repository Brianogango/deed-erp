import { describe, expect, it } from 'vitest'
import { computeWht, shouldApplyWhtOnInvoice } from '@/lib/wht'

describe('withholding tax', () => {
  it('computes net payable', () => {
    expect(computeWht(10000, 5)).toEqual({
      gross: 10000,
      ratePct: 5,
      whtAmount: 500,
      netPayable: 9500,
    })
  })

  it('only applies to vendor bills when enabled', () => {
    expect(shouldApplyWhtOnInvoice({ enabled: true, invoiceType: 'vendor_bill' })).toBe(true)
    expect(shouldApplyWhtOnInvoice({ enabled: true, invoiceType: 'customer_invoice' })).toBe(false)
    expect(shouldApplyWhtOnInvoice({ enabled: false, invoiceType: 'vendor_bill' })).toBe(false)
  })
})
