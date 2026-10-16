import { describe, it, expect } from 'vitest'
import { auditSalesOrders } from '@/lib/sales/order-audit'

const products = [{ id: 'p1', name: 'Laptop', trackingMethod: 'SERIAL' }, { id: 'svc', name: 'Setup', unit: 'service' }]
const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id, ref: `SO/2026/${id}`, status: 'sale', customerId: 'c1', customerName: 'Farm To Feed', total: 249400, date: '2026-09-01',
  lines: [{ productId: 'p1' }], ...extra,
})

describe('auditSalesOrders()', () => {
  it('flags an invoiced order with no completed delivery, and counts its held serials', () => {
    const r = auditSalesOrders({
      orders: [order('0113')],
      invoices: [{ saleOrderId: '0113', ref: 'INV/2026/0191', status: 'posted', total: 256708, amountPaid: 256708 }],
      deliveries: [{ saleOrderId: '0113', ref: 'DN/2026/0276', status: 'waiting' }],
      serials: [{ saleOrderId: '0113', status: 'assigned' }, { saleOrderId: '0113', status: 'assigned' }],
      products,
    })
    expect(r.invoicedBeforeDelivery).toHaveLength(1)
    expect(r.invoicedBeforeDelivery[0]).toMatchObject({ ref: 'SO/2026/0113', invoices: ['INV/2026/0191'], paid: 256708, heldSerials: 2 })
  })

  it('does not flag an invoiced order whose delivery is done, a service-only order, or an uninvoiced one', () => {
    const r = auditSalesOrders({
      orders: [order('1'), order('2', { lines: [{ productId: 'svc' }] }), order('3', { customerId: 'c2' })],
      invoices: [
        { saleOrderId: '1', ref: 'I1', status: 'posted', total: 1 }, { saleOrderId: '2', ref: 'I2', status: 'posted', total: 1 },
      ],
      deliveries: [{ saleOrderId: '1', ref: 'D1', status: 'done' }],
      serials: [], products,
    })
    expect(r.invoicedBeforeDelivery).toEqual([])
  })

  it('groups confirmed orders for one customer with the same total close together as possible duplicates', () => {
    const r = auditSalesOrders({
      orders: [order('0111'), order('0112', { date: '2026-09-02' }), order('0113', { date: '2026-09-02' }), order('9', { customerId: 'c3', total: 5 })],
      invoices: [], deliveries: [], serials: [], products,
    })
    expect(r.possibleDuplicates).toHaveLength(1)
    expect(r.possibleDuplicates[0].orders.map(o => o.ref)).toEqual(['SO/2026/0111', 'SO/2026/0112', 'SO/2026/0113'])
  })

  it('ignores same-customer same-total orders months apart (repeat purchases)', () => {
    const r = auditSalesOrders({
      orders: [order('1', { date: '2026-01-01' }), order('2', { date: '2026-09-01' })],
      invoices: [], deliveries: [], serials: [], products,
    })
    expect(r.possibleDuplicates).toEqual([])
  })
})
