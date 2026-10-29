import { describe, it, expect } from 'vitest'
import { checkoutExpenseFor, reverseCheckoutBookings, type CheckoutBooking } from '@/lib/inventory/checkout-accounting'

const b = (outcome: 'consumed' | 'missing', qty: number, unitCost: number, reversedQty = 0): CheckoutBooking =>
  ({ outcome, qty, unitCost, code: outcome === 'missing' ? '6306' : '6301', text: 'x', reversedQty, at: '2026-10-01' })

describe('checkout accounting', () => {
  it('picks the expense by purpose, write-off for missing', () => {
    expect(checkoutExpenseFor('consumed', 'Repair').code).toBe('6301')
    expect(checkoutExpenseFor('consumed', 'Refurbishment').code).toBe('6301')
    expect(checkoutExpenseFor('consumed', 'Testing').code).toBe('6599')
    expect(checkoutExpenseFor('consumed', 'something else').code).toBe('6599')
    expect(checkoutExpenseFor('missing', 'Repair').code).toBe('6306')
  })

  it('reverses oldest bookings of the outcome first, at their own cost', () => {
    const { bookings, reversals } = reverseCheckoutBookings([b('consumed', 2, 100, 1), b('missing', 3, 50), b('consumed', 2, 120)], 'consumed', 2)
    expect(reversals).toEqual([{ qty: 1, unitCost: 100, code: '6301', text: 'x' }, { qty: 1, unitCost: 120, code: '6301', text: 'x' }])
    expect(bookings.map(x => x.reversedQty)).toEqual([2, 0, 1])
  })

  it('skips units with no booking behind them', () => {
    const { reversals } = reverseCheckoutBookings([b('missing', 1, 50)], 'missing', 3)
    expect(reversals).toEqual([{ qty: 1, unitCost: 50, code: '6306', text: 'x' }])
  })
})
