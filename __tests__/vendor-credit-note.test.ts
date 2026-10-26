import { describe, expect, it } from 'vitest'
import { vendorCreditSummary, isVendorCreditNote } from '@/lib/finance/vendor-credit-note'
import { invoicePaymentStatus, financeListPaymentStatusLabel } from '@/lib/odoo-sales-flow'

const vcn = { id: 'c1', ref: 'VCN/2026/0003', type: 'vendor_bill', status: 'posted', total: -26000, amountPaid: -26000, notes: 'Purchase return RET/1\nApplied to BILL/2026/0010' }
const bill = { id: 'b1', ref: 'BILL/2026/0010', type: 'vendor_bill', status: 'posted', total: 50000, amountPaid: 26000,
  payments: [{ amount: 26000, method: 'vendor_credit', reference: 'VCN/2026/0003' }] }

describe('supplier credit notes', () => {
  it('a fully used credit note reads Applied, not Not Paid', () => {
    expect(invoicePaymentStatus(vcn)).toBe('paid')
    expect(financeListPaymentStatusLabel(vcn)).toBe('Applied')
  })
  it('an unused credit note is an open credit, part-used is part applied', () => {
    expect(financeListPaymentStatusLabel({ ...vcn, amountPaid: 0 })).toBe('Open credit')
    expect(financeListPaymentStatusLabel({ ...vcn, amountPaid: -10000 })).toBe('Part applied')
  })
  it('names the bill the credit was used on, with the amount', () => {
    expect(isVendorCreditNote(vcn)).toBe(true)
    expect(isVendorCreditNote(bill)).toBe(false)
    const s = vendorCreditSummary(vcn, [vcn, bill])
    expect(s).toMatchObject({ amount: 26000, applied: 26000, remaining: 0 })
    expect(s.usedOn).toEqual([{ billId: 'b1', billRef: 'BILL/2026/0010', amount: 26000 }])
  })
  it('falls back to the notes when the bill has no matching payment', () => {
    const s = vendorCreditSummary(vcn, [{ ...bill, payments: [] }])
    expect(s.usedOn).toEqual([{ billId: 'b1', billRef: 'BILL/2026/0010', amount: 26000 }])
  })
  it('shows what the supplier still owes when only part was used', () => {
    expect(vendorCreditSummary({ ...vcn, amountPaid: -6000 }, []).remaining).toBe(20000)
  })
  it('normal bills keep their usual status', () => {
    expect(invoicePaymentStatus(bill)).toBe('partially_paid')
    expect(invoicePaymentStatus({ ...bill, amountPaid: 0 })).toBe('not_paid')
  })
})

describe('supplier credit refunds', () => {
  it('counts refunds on the credit note itself', () => {
    const credit = { id: 'c2', ref: 'VCN/2026/0009', type: 'vendor_bill', status: 'posted', total: -23000, amountPaid: -23000, payments: [{ amount: 23000, method: 'bank_transfer', supplierRefund: true }] }
    expect(vendorCreditSummary(credit, [credit])).toMatchObject({ amount: 23000, applied: 23000, remaining: 0, refunded: 23000 })
  })
})
