import { describe, expect, it } from 'vitest'
import { evaluateCustomerCreditGate, isPayOnReceipt } from '@/lib/customer-credit-gate'
import { customerPaymentTermsDays, contactPaymentTermsDays } from '@/lib/due-date'

const base = { overdueBalance: 0, overdueCount: 0, creditLimit: 0, outstandingBalance: 0, newOrderTotal: 50_000 }

describe('pay on receipt (corporate customers without approved credit)', () => {
  it('only companies with no, suspended or revoked credit pay on receipt', () => {
    expect(isPayOnReceipt({ type: 'company', creditStatus: 'none' })).toBe(true)
    expect(isPayOnReceipt({ type: 'company', creditStatus: 'suspended' })).toBe(true)
    expect(isPayOnReceipt({ type: 'company', creditStatus: 'revoked' })).toBe(true)
    expect(isPayOnReceipt({ type: 'company', creditStatus: 'approved' })).toBe(false)
    expect(isPayOnReceipt({ type: 'company', creditStatus: 'legacy' })).toBe(false)
    expect(isPayOnReceipt({ type: 'individual', creditStatus: 'none' })).toBe(false)
    expect(isPayOnReceipt({ clientType: 'company', creditStatus: 'none' })).toBe(true)
    // An old cached record without a standing is left to the server.
    expect(isPayOnReceipt({ type: 'company' })).toBe(false)
  })

  it('blocks a new order or invoice while money is owed; quotes stay open', () => {
    const owed = { ...base, outstandingBalance: 1_000, payOnReceipt: true }
    expect(evaluateCustomerCreditGate({ ...owed, document: 'order' })).toMatchObject({ ok: false, payOnReceiptBlocked: true })
    expect(evaluateCustomerCreditGate({ ...owed, document: 'invoice' })).toMatchObject({ ok: false, payOnReceiptBlocked: true })
    expect(evaluateCustomerCreditGate({ ...owed, document: 'quote' }).ok).toBe(true)
    expect(evaluateCustomerCreditGate({ ...base, payOnReceipt: true, document: 'order' }).ok).toBe(true)
    expect(evaluateCustomerCreditGate({ ...owed, payOnReceipt: false, document: 'order' }).ok).toBe(true)
  })

  it('invoices for pay-on-receipt companies fall due on the day; vendors keep their terms', () => {
    expect(customerPaymentTermsDays({ type: 'company', creditStatus: 'none', paymentTermsDays: 30 }, 14, true)).toBe(0)
    expect(customerPaymentTermsDays({ type: 'company', creditStatus: 'approved', paymentTermsDays: 45 }, 14, true)).toBe(45)
    expect(customerPaymentTermsDays({ type: 'individual', creditStatus: 'none', paymentTermsDays: 7 }, 14, true)).toBe(7)
    // Switched off (the default): the contact's own terms apply.
    expect(customerPaymentTermsDays({ type: 'company', creditStatus: 'none', paymentTermsDays: 30 }, 14)).toBe(30)
    expect(customerPaymentTermsDays({ type: 'company', creditStatus: 'none', paymentTermsDays: 30 }, 14, false)).toBe(30)
    expect(contactPaymentTermsDays({ paymentTermsDays: 30 }, 14)).toBe(30)
  })
})
