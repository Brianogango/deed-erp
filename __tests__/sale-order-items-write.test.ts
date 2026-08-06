import { describe, expect, it } from 'vitest'
import { buildSaleOrderItemsNestedWrite, mapSaleOrderItems } from '@/lib/sale-order-items-write'

const EXISTING = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    description: 'Laptop',
    qty: 2,
    qtyDelivered: 1,
    qtyInvoiced: 0,
    unitPrice: 1000,
    taxRate: 16,
    lineTotal: 2000,
    notes: null,
    serialNumberId: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    productId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    description: 'Mouse',
    qty: 1,
    qtyDelivered: 0,
    qtyInvoiced: 0,
    unitPrice: 500,
    taxRate: 16,
    lineTotal: 500,
    notes: null,
    serialNumberId: null,
  },
]

describe('sale-order-items-write', () => {
  it('preserves stable line ids on update instead of churning UUIDs', () => {
    const nested = buildSaleOrderItemsNestedWrite(
      [
        {
          id: EXISTING[0].id,
          productId: EXISTING[0].productId,
          description: 'Laptop Pro',
          qty: 3,
          unitPrice: 1100,
          taxRate: 16,
          lineTotal: 3300,
        },
      ],
      EXISTING,
    )
    expect(nested.deleteMany).toEqual({ id: { in: [EXISTING[1].id] } })
    expect(nested.update).toHaveLength(1)
    expect(nested.update?.[0].where.id).toBe(EXISTING[0].id)
    expect(nested.update?.[0].data.qty).toBe(3)
    expect(nested.update?.[0].data.qtyDelivered).toBe(1)
    expect(nested.create).toBeUndefined()
  })

  it('creates new lines without an id and keeps delivered qty when matching', () => {
    const mapped = mapSaleOrderItems(
      [{ productId: EXISTING[0].productId, description: 'Laptop', qty: 2, unitPrice: 1000, taxRate: 16, lineTotal: 2000 }],
      EXISTING,
    )
    expect(mapped[0].id).toBe(EXISTING[0].id)
    expect(mapped[0].qtyDelivered).toBe(1)
  })
})
