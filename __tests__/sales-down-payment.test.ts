import { describe, expect, it } from 'vitest'
import {
  computeDownPaymentAmount,
  downPaymentDeductionForFinal,
  isUnappliedDownPayment,
  normalizeCreateInvoiceMode,
  sumUnappliedDownPayments,
} from '@/lib/sales/down-payment'

describe('down-payment helpers', () => {
  it('normalizes create-invoice modes', () => {
    expect(normalizeCreateInvoiceMode('down_payment_percent')).toBe('down_payment_percent')
    expect(normalizeCreateInvoiceMode('final')).toBe('final')
    expect(normalizeCreateInvoiceMode(undefined)).toBe('regular')
  })

  it('computes percent and fixed downs without exceeding remaining balance', () => {
    expect(computeDownPaymentAmount({
      mode: 'down_payment_percent',
      orderTotal: 100000,
      percent: 30,
    })).toEqual({ ok: true, amount: 30000, percent: 30 })

    expect(computeDownPaymentAmount({
      mode: 'down_payment_fixed',
      orderTotal: 100000,
      amount: 150000,
      priorDownPayments: 0,
    }).ok).toBe(false)

    expect(computeDownPaymentAmount({
      mode: 'down_payment_fixed',
      orderTotal: 100000,
      amount: 40000,
      priorDownPayments: 70000,
    }).ok).toBe(false)

    expect(computeDownPaymentAmount({
      mode: 'down_payment_fixed',
      orderTotal: 100000,
      amount: 30000,
      priorDownPayments: 70000,
    })).toMatchObject({ ok: true, amount: 30000 })
  })

  it('sums only unapplied down payments', () => {
    const total = sumUnappliedDownPayments([
      { saleOrderId: 'so1', isDownPayment: true, total: 10000, status: 'draft' },
      { saleOrderId: 'so1', isDownPayment: true, total: 5000, status: 'approved', downPaymentAppliedToId: 'inv-final' },
      { saleOrderId: 'so1', notes: '[Down Payment 10%]', total: 2000, status: 'draft' },
      { saleOrderId: 'so2', isDownPayment: true, total: 999, status: 'draft' },
    ], 'so1')
    expect(total).toBe(12000)
    expect(isUnappliedDownPayment({ saleOrderId: 'so1', isDownPayment: true, status: 'cancelled', total: 1 }, 'so1')).toBe(false)
  })

  it('caps final deduction so invoice cannot go negative', () => {
    expect(downPaymentDeductionForFinal({
      invoiceSubtotal: 10000,
      invoiceTax: 1600,
      headerDiscount: 600,
      priorDownPayments: 50000,
    })).toBe(11000)
  })
})
