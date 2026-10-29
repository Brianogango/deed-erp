/**
 * Where stock taken out on a checkout is expensed when it is closed.
 *
 * Issue and return move no value: the stock is still ours, only out with
 * someone. Consumed stock is gone, so its cost leaves inventory for an
 * expense chosen by the checkout's purpose. Missing stock is a loss
 * (inventory write-off). Damaged stock is still ours (set aside in
 * Inbound › Rejected) and stays in inventory until repaired or written off.
 */

export type CheckoutBookedOutcome = 'consumed' | 'missing'

/** 6301 direct repair costs; 6599 other operating expenses; 6306 inventory write-off. */
export const CHECKOUT_EXPENSE_BY_PURPOSE: Record<string, { code: string; text: string }> = {
  Repair: { code: '6301', text: 'Parts consumed on repair' },
  Refurbishment: { code: '6301', text: 'Parts consumed on refurbishment' },
  Testing: { code: '6599', text: 'Stock consumed in testing' },
  'Internal installation': { code: '6599', text: 'Stock used internally' },
  Other: { code: '6599', text: 'Stock consumed' },
}

export const CHECKOUT_MISSING_EXPENSE = { code: '6306', text: 'Checkout stock missing' }

export function checkoutExpenseFor(outcome: CheckoutBookedOutcome, purpose: string): { code: string; text: string } {
  if (outcome === 'missing') return CHECKOUT_MISSING_EXPENSE
  return CHECKOUT_EXPENSE_BY_PURPOSE[String(purpose || '').trim()] ?? CHECKOUT_EXPENSE_BY_PURPOSE.Other
}

/** One closing that moved value out of inventory, so a later return can reverse exactly it. */
export type CheckoutBooking = {
  outcome: CheckoutBookedOutcome
  qty: number
  unitCost: number
  code: string
  text: string
  reversedQty: number
  at: string
}

/**
 * Units being brought back after closing: take them from the bookings of
 * that outcome, oldest first, and say what to reverse at which cost.
 * Units with no booking behind them (closed before bookings existed) are
 * left out — nothing was taken off the books for them.
 */
export function reverseCheckoutBookings(
  bookings: CheckoutBooking[],
  outcome: CheckoutBookedOutcome,
  qty: number,
): { bookings: CheckoutBooking[]; reversals: Array<{ qty: number; unitCost: number; code: string; text: string }> } {
  let left = Math.max(0, Math.floor(qty))
  const reversals: Array<{ qty: number; unitCost: number; code: string; text: string }> = []
  const next = bookings.map(b => {
    if (left <= 0 || b.outcome !== outcome) return b
    const open = Math.max(0, b.qty - b.reversedQty)
    const take = Math.min(open, left)
    if (take <= 0) return b
    left -= take
    reversals.push({ qty: take, unitCost: b.unitCost, code: b.code, text: b.text })
    return { ...b, reversedQty: b.reversedQty + take }
  })
  return { bookings: next, reversals }
}
