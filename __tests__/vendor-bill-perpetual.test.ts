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

  it('uses input VAT and AP role labels', () => {
    const lines = buildVendorBillPerpetualLines({
      partnerName: 'Acme',
      ref: 'BILL/3',
      subtotal: 1000,
      taxTotal: 160,
      total: 1160,
      perpetual: false,
      lines: [{ qty: 1, unitPrice: 1000, subtotal: 1000 }],
    })
    expect(lines.some(l => l.account === '1150 - VAT Input' && l.debit === 160)).toBe(true)
    expect(lines.some(l => l.account === '3000 - Accounts Payable' && l.credit === 1160)).toBe(true)
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

  it('debits PPE 1702 for a furniture bill line, never inventory 1200 or purchases 6101', () => {
    const lines = buildVendorBillPerpetualLines({
      partnerName: 'Woodworks',
      ref: 'BILL/PPE',
      subtotal: 45000,
      taxTotal: 7200,
      total: 52200,
      perpetual: false,
      lines: [{ qty: 1, unitPrice: 45000, subtotal: 45000, accountCode: '1702', isStocked: true }],
    })
    expect(lines.some(l => l.account.includes('1702') && l.debit === 45000)).toBe(true)
    expect(lines.some(l => l.account.includes('1200'))).toBe(false)
    expect(lines.some(l => l.account.includes('6101'))).toBe(false)
    expect(lines.find(l => l.account.includes('3000'))?.credit).toBe(52200)
  })

  it('keeps PPE and stocked lines separate on a mixed bill', () => {
    const lines = buildVendorBillPerpetualLines({
      partnerName: 'Acme',
      ref: 'BILL/MIX',
      subtotal: 2000,
      taxTotal: 0,
      total: 2000,
      perpetual: true,
      lines: [
        { qty: 1, unitPrice: 1000, subtotal: 1000, accountCode: '1703', isStocked: true, receiptUnitCost: 1000 },
        { qty: 1, unitPrice: 1000, subtotal: 1000, isStocked: true, receiptUnitCost: 1000 },
      ],
    })
    expect(lines.some(l => l.account.includes('1703') && l.debit === 1000)).toBe(true)
    expect(lines.find(l => l.account === GRNI_ACCOUNT_LABEL)?.debit).toBe(1000)
    expect(lines.some(l => l.account.includes('6101'))).toBe(false)
  })

  it('credits PPE on a vendor credit for an office-equipment line', () => {
    const lines = buildVendorCreditPerpetualLines({
      partnerName: 'Woodworks',
      ref: 'VCN/PPE',
      subtotal: -45000,
      taxTotal: 0,
      total: -45000,
      perpetual: false,
      lines: [{ qty: 1, unitPrice: 45000, subtotal: 45000, ppeAccountCode: '1702' }],
    })
    expect(lines.find(l => l.account.includes('3000'))?.debit).toBe(45000)
    expect(lines.some(l => l.account.includes('1702') && l.credit === 45000)).toBe(true)
    expect(lines.some(l => l.account.includes('6101'))).toBe(false)
  })
})
