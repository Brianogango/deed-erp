import { describe, expect, it } from 'vitest'
import {
  buildPaymentReceiptContent,
  paymentReceiptAlreadySent,
} from '@/lib/finance/payment-receipt-notify'

describe('buildPaymentReceiptContent', () => {
  it('marks paid in full when balance is zero', () => {
    const content = buildPaymentReceiptContent({
      customerName: 'Resolute',
      invoiceRef: 'INV/2026/0057',
      amount: 87000,
      paymentMethod: 'mpesa',
      reference: 'QWERTY',
      paidAtLabel: '2026-08-10',
      totalAmount: 87000,
      amountPaid: 87000,
      balance: 0,
    })
    expect(content.subject).toContain('paid in full')
    expect(content.text).toContain('Paid in full')
    expect(content.whatsappText).toMatch(/paid in full/i)
  })

  it('shows remaining balance for partial payments', () => {
    const content = buildPaymentReceiptContent({
      customerName: 'Acme',
      invoiceRef: 'INV/2026/0001',
      amount: 10000,
      paymentMethod: 'cash',
      reference: null,
      paidAtLabel: '2026-08-10',
      totalAmount: 50000,
      amountPaid: 10000,
      balance: 40000,
    })
    expect(content.subject).not.toContain('paid in full')
    expect(content.text).toContain('Balance remaining: KES 40,000')
  })
})

describe('paymentReceiptAlreadySent', () => {
  it('detects a prior successful send for the payment id', () => {
    expect(paymentReceiptAlreadySent([
      { documentType: 'payment_receipt', documentId: 'pay-1', status: 'success' },
    ], 'pay-1')).toBe(true)
    expect(paymentReceiptAlreadySent([
      { documentType: 'payment_receipt', documentId: 'pay-1', status: 'failed' },
    ], 'pay-1')).toBe(false)
    expect(paymentReceiptAlreadySent([
      { documentType: 'invoice', documentId: 'pay-1', status: 'success' },
    ], 'pay-1')).toBe(false)
  })
})

describe('paymentReceiptAlreadySent multi-invoice', () => {
  it('allows a second invoice on the same payment id', () => {
    const prior = [
      { documentType: 'payment_receipt', documentId: 'pay-1', status: 'success', documentRef: 'INV/1' },
    ]
    expect(paymentReceiptAlreadySent(prior, 'pay-1', 'INV/1')).toBe(true)
    expect(paymentReceiptAlreadySent(prior, 'pay-1', 'INV/2')).toBe(false)
  })
})
