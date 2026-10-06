import { describe, it, expect } from 'vitest'
import { planHeldDelivery } from '@/lib/sales/deliver-held'

const so = { id: 'so4', ref: 'SO/2026/0004', lines: [{ productId: 'p845', productName: 'HP EliteBook 845 G7', qty: 5 }] }
const serial = (n: number, over: Record<string, unknown> = {}) => ({ id: `s${n}`, serial: `5CG00${n}`, productId: 'p845', productName: 'HP EliteBook 845 G7', status: 'assigned', location: 'warehouse', ...over })

describe('planHeldDelivery', () => {
  it('picks held units for this order or no order, up to what is still owed', () => {
    const serials = [
      serial(1), serial(2, { saleOrderId: 'so4' }), serial(3), serial(4), serial(5), serial(6),
      serial(7, { saleOrderId: 'so9' }),
      serial(8, { status: 'refurbishment' }),
      serial(9, { location: 'pending_testing' }),
      serial(10, { status: 'available' }),
    ]
    const [line] = planHeldDelivery({ saleOrder: so, serials, deliveries: [], saleOrders: [so, { id: 'so9', ref: 'SO/2026/0009' }] })
    expect(line.remaining).toBe(5)
    expect(line.pick.map(p => p.serial)).toEqual(['5CG001', '5CG002', '5CG003', '5CG004', '5CG005'])
    expect(line.heldForOtherOrders).toEqual([{ serial: '5CG007', orderRef: 'SO/2026/0009' }])
    expect(line.heldElsewhere.map(h => h.serial)).toEqual(['5CG008', '5CG009'])
  })

  it('counts what validated deliveries already sent', () => {
    const deliveries = [{ saleOrderId: 'so4', status: 'done', lines: [{ productId: 'p845', qty: 3, qtyDone: 3 }] }]
    const [line] = planHeldDelivery({ saleOrder: so, serials: [serial(1), serial(2), serial(3)], deliveries, saleOrders: [so] })
    expect(line).toMatchObject({ delivered: 3, remaining: 2 })
    expect(line.pick).toHaveLength(2)
  })
})
