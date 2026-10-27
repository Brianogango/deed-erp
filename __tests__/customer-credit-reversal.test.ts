import { describe, expect, it } from 'vitest'
import { restoreCustomerCredits } from '@/lib/accounting/payment-reversal'

const at = '2026-10-27T12:00:00.000Z'
const credit = (over: Record<string, unknown> = {}) => ({
  id: 'c1', ref: 'CC/0001', customerId: 'cus', amount: 5000, balance: 0, status: 'used',
  applications: [{ invoiceId: 'inv-1', invoiceRef: 'INV/1', amount: 5000, date: '2026-10-20', appliedBy: 'Ann' }],
  ...over,
})

describe('restoreCustomerCredits', () => {
  it('returns the applied amount to the credit and marks the application reversed', () => {
    const { credits, restored } = restoreCustomerCredits([credit()], { invoiceId: 'inv-1', refs: ['CC/0001'], amount: 5000, reason: 'wrong invoice', at, by: 'Ann' })
    expect(restored).toBe(5000)
    expect(credits[0]).toMatchObject({ balance: 5000, status: 'available' })
    expect(credits[0].applications[0]).toMatchObject({ reversedAt: at, reverseReason: 'wrong invoice' })
  })

  it('splits across the credits the payment drew on', () => {
    const a = credit({ amount: 3000, balance: 0, applications: [{ invoiceId: 'inv-1', amount: 3000 }] })
    const b = credit({ id: 'c2', ref: 'CC/0002', amount: 4000, balance: 2000, status: 'partially_used', applications: [{ invoiceId: 'inv-1', amount: 2000 }] })
    const { credits, restored } = restoreCustomerCredits([a, b], { invoiceId: 'inv-1', refs: ['CC/0001', 'CC/0002'], amount: 5000, reason: 'x', at, by: 'Ann' })
    expect(restored).toBe(5000)
    expect(credits.map(c => [c.balance, c.status])).toEqual([[3000, 'available'], [4000, 'available']])
  })

  it('only touches applications to this invoice, and never twice', () => {
    const c = credit({ amount: 6000, balance: 0, applications: [
      { invoiceId: 'other', amount: 1000 },
      { invoiceId: 'inv-1', amount: 5000 },
    ] })
    const once = restoreCustomerCredits([c], { invoiceId: 'inv-1', refs: ['CC/0001'], amount: 5000, reason: 'x', at, by: 'Ann' })
    expect(once.credits[0]).toMatchObject({ balance: 5000, status: 'partially_used' })
    const twice = restoreCustomerCredits(once.credits, { invoiceId: 'inv-1', refs: ['CC/0001'], amount: 5000, reason: 'x', at, by: 'Ann' })
    expect(twice.restored).toBe(0)
  })

  it('reports nothing restored when the credit is not named', () => {
    expect(restoreCustomerCredits([credit()], { invoiceId: 'inv-1', refs: ['CC/9999'], amount: 5000, reason: 'x', at, by: 'Ann' }).restored).toBe(0)
  })
})
