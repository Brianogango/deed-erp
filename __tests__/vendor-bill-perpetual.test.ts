import { describe, expect, it } from 'vitest'
import {
  buildVendorBillPerpetualLines,
  buildVendorCreditPerpetualLines,
  GRNI_ACCOUNT_LABEL,
} from '@/lib/accounting/vendor-bill-perpetual'

describe('vendor bill perpetual posting', () => {
  it('expenses when perpetual is off', () => {
    const lines = buildVendorBillPerpetualLines({
      partnerName: 'Acme',
      ref: 'BILL/1',
      subtotal: 1000,
      taxTotal: 160,
      total: 1160,
      perpetual: false,
      lines: [{ qty: 2, unitPrice: 500, subtotal: 1000, isStocked: true, receiptUnitCost: 500 }],
    })
    expect(lines.some(l => l.account.includes('6101') && l.debit === 1000)).toBe(true)
    expect(lines.some(l => l.account === GRNI_ACCOUNT_LABEL)).toBe(false)
  })

  it('clears GRNI and posts price variance when bill > receipt cost', () => {
    const lines = buildVendorBillPerpetualLines({
      partnerName: 'Acme',
      ref: 'BILL/2',
      subtotal: 1100,
      taxTotal: 0,
      total: 1100,
      perpetual: true,
      lines: [{ qty: 2, unitPrice: 550, subtotal: 1100, isStocked: true, receiptUnitCost: 500 }],
    })
    const grni = lines.find(l => l.account === GRNI_ACCOUNT_LABEL)
    expect(grni?.debit).toBe(1000)
    const variance = lines.find(l => l.account.includes('6210'))
    expect(variance?.debit).toBe(100)
    expect(lines.some(l => l.account.includes('6101') && l.debit > 0)).toBe(false)
    expect(lines.find(l => l.account.includes('3000'))?.credit).toBe(1100)
  })

  it('vendor credit under perpetual credits GRNI not purchase expense', () => {
    const lines = buildVendorCreditPerpetualLines({
      partnerName: 'Acme',
      ref: 'VCN/1',
      subtotal: -1000,
      taxTotal: 0,
      total: -1000,
      perpetual: true,
      lines: [{ qty: 2, unitPrice: 500, subtotal: 1000, isStocked: true, receiptUnitCost: 500 }],
    })
    expect(lines.find(l => l.account.includes('3000'))?.debit).toBe(1000)
    expect(lines.find(l => l.account === GRNI_ACCOUNT_LABEL)?.credit).toBe(1000)
    expect(lines.some(l => l.account.includes('6101') && l.credit > 0)).toBe(false)
  })
})
