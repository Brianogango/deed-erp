import { describe, it, expect } from 'vitest'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'

describe('saleOrderPersistBody', () => {
  it('omits lockVersion and expectedVersion so stale clients cannot 409 draft line saves', () => {
    const body = saleOrderPersistBody({
      id: 'so-1',
      status: 'quotation',
      lockVersion: 4,
      expectedVersion: 4,
      lines: [{ id: 'l1', productId: 'p1', qty: 2 }],
      notes: 'hello',
    })
    expect(body).toEqual({
      id: 'so-1',
      status: 'quotation',
      lines: [{ id: 'l1', productId: 'p1', qty: 2 }],
      notes: 'hello',
    })
    expect('lockVersion' in body).toBe(false)
    expect('expectedVersion' in body).toBe(false)
  })

  it('strips stale Prisma items so they cannot override edited lines', () => {
    const body = saleOrderPersistBody({
      id: 'so-1',
      lines: [{ id: 'a' }],
      items: [{ id: 'a' }, { id: 'b-deleted' }],
      lockVersion: 1,
    })
    expect(body.lines).toHaveLength(1)
    expect('items' in body).toBe(false)
  })

  it('strips orderNumber/ref so draft line saves cannot collide on unique order_number', () => {
    const body = saleOrderPersistBody({
      id: 'so-1',
      ref: 'QUO/2026/0001',
      orderNumber: 'QUO/2026/0001',
      lines: [{ id: 'a', taxRate: 16 }],
      lockVersion: 2,
    })
    expect('ref' in body).toBe(false)
    expect('orderNumber' in body).toBe(false)
    expect(body.lines).toEqual([{ id: 'a', taxRate: 16 }])
  })
})
