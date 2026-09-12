import { describe, expect, it } from 'vitest'
import { fulfillmentSaleOrderPatch } from '@/lib/sales/fulfillment-sale-order-patch'

describe('fulfillmentSaleOrderPatch', () => {
  it('omits lockVersion so a post-validate write cannot 409 after deliver-lines', () => {
    const body = fulfillmentSaleOrderPatch({
      id: 'so-1',
      status: 'sale',
      lockVersion: 1,
      expectedVersion: 1,
      items: [{ id: 'stale' }],
      lines: [{ id: 'l1', qty: 2, qtyDelivered: 2 }],
      orderNumber: 'SO/2026/0001',
      ref: 'SO/2026/0001',
    })
    expect('lockVersion' in body).toBe(false)
    expect('expectedVersion' in body).toBe(false)
    expect('items' in body).toBe(false)
    expect(body.lines).toEqual([{ id: 'l1', qty: 2, qtyDelivered: 2 }])
    expect(body.fulfillmentTrim).toBe(false)
  })

  it('sets fulfillmentTrim only when remaining lines were dropped', () => {
    const body = fulfillmentSaleOrderPatch(
      { id: 'so-1', lines: [] },
      { cancelRemaining: true, trimmedChanged: true },
    )
    expect(body.fulfillmentTrim).toBe(true)
  })
})
