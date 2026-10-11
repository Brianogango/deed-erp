import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: {} }))

import { reservationColumns } from '@/lib/inventory/reservation-mirror'

const SO = '11111111-2222-4333-8444-555555555555'
const PRODUCT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SERIAL = 'ffffffff-1111-4222-8333-444444444444'

describe('reservation table columns', () => {
  const screen = {
    id: 'rsv-1', productId: PRODUCT, productName: 'HP 840 G5', qty: 2,
    reservedFor: 'sales_order', referenceId: SO, referenceRef: 'SO/2026/0100', referenceType: 'sale_order',
    location: 'warehouse', reservedBy: 'Brian', reservedDate: '2026-10-01T08:00:00.000Z',
    status: 'reserved', fulfilledQty: 0, serialNumbers: [SERIAL, 'other'],
  }

  it('keeps the whole reservation and fills the main columns', () => {
    const c = reservationColumns(screen, new Set([PRODUCT]), new Set([SERIAL]))
    expect(c.screenExtras).toBe(screen)
    expect(c.saleOrderId).toBe(SO)
    expect(c.productId).toBe(PRODUCT)
    expect(c.serialId).toBe(SERIAL)
    expect(c.qty).toBe(2)
    expect(c.status).toBe('reserved')
    expect(c.reservedAt.toISOString()).toBe('2026-10-01T08:00:00.000Z')
    expect(c.removedAt).toBeNull()
  })

  it('leaves out links the tables do not have', () => {
    const c = reservationColumns({ ...screen, reservedFor: 'repair' }, new Set(), new Set())
    expect(c.saleOrderId).toBeNull()
    expect(c.productId).toBeNull()
    expect(c.serialId).toBeNull()
  })

  it('records when a fulfilled reservation was released', () => {
    const c = reservationColumns({ ...screen, status: 'fulfilled', fulfilledDate: '2026-10-05T10:00:00.000Z' }, new Set(), new Set())
    expect(c.releasedAt?.toISOString()).toBe('2026-10-05T10:00:00.000Z')
  })
})
