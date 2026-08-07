import { describe, it, expect } from 'vitest'

/**
 * Mirrors the production guard in app/api/sale-orders/[id]/route.ts:
 * metadata-only PATCH must not rewrite the full deed_saleOrders blob.
 */
function shouldBroadcastSaleOrders(body: Record<string, unknown>, opts: {
  confirming: boolean
  statusChanged: boolean
}) {
  const touchedLines = Array.isArray(body.items ?? body.lines)
  return touchedLines || opts.confirming || opts.statusChanged
}

describe('sale-order broadcast guard', () => {
  it('skips blob broadcast for notes / validUntil / discount patches', () => {
    expect(shouldBroadcastSaleOrders({ notes: 'hello' }, { confirming: false, statusChanged: false })).toBe(false)
    expect(shouldBroadcastSaleOrders({ validUntil: '2026-09-01' }, { confirming: false, statusChanged: false })).toBe(false)
    expect(shouldBroadcastSaleOrders({ discountAmount: 100, total: 900 }, { confirming: false, statusChanged: false })).toBe(false)
  })

  it('broadcasts when lines change, confirm, or status transitions', () => {
    expect(shouldBroadcastSaleOrders({ lines: [{ id: 'a' }] }, { confirming: false, statusChanged: false })).toBe(true)
    expect(shouldBroadcastSaleOrders({ items: [{ id: 'a' }] }, { confirming: false, statusChanged: false })).toBe(true)
    expect(shouldBroadcastSaleOrders({ notes: 'x' }, { confirming: true, statusChanged: true })).toBe(true)
    expect(shouldBroadcastSaleOrders({}, { confirming: false, statusChanged: true })).toBe(true)
  })
})
