import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: { stockReservation: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { loadScreenReservations } from '@/lib/stock-read-model.server'

const row = (blobId: string, extras: Record<string, unknown> | null, more: Record<string, unknown> = {}) => ({
  blobId, screenExtras: extras, status: (extras?.status as string) ?? 'reserved', releasedAt: null, removedAt: null, ...more,
})

beforeEach(() => findMany.mockReset())

describe('reservations read from stock_reservations', () => {
  it('lists each reservation as saved, by its screen id', async () => {
    findMany.mockResolvedValue([row('r1', { id: 'r1', productName: 'HP 840', qty: 2, status: 'reserved' })])
    const out = await loadScreenReservations([])
    expect(out).toEqual([{ id: 'r1', productName: 'HP 840', qty: 2, status: 'reserved' }])
  })

  it('takes the status the server set when it released a reservation', async () => {
    const releasedAt = new Date('2026-10-11T09:00:00Z')
    findMany.mockResolvedValue([row('r1', { id: 'r1', status: 'reserved' }, { status: 'cancelled', releasedAt })])
    const [r] = await loadScreenReservations([])
    expect(r.status).toBe('cancelled')
    expect(r.releasedDate).toBe('2026-10-11T09:00:00.000Z')
  })

  it('drops removed reservations, even though the frozen copy still has them', async () => {
    findMany.mockResolvedValue([
      row('r1', { id: 'r1', status: 'reserved' }),
      row('r2', { id: 'r2', status: 'reserved' }, { removedAt: new Date() }),
    ])
    const out = await loadScreenReservations([{ id: 'r1' }, { id: 'r2' }, { id: 'r3', status: 'reserved' }])
    expect(out.map(r => r.id)).toEqual(['r1', 'r3'])
  })

  it('falls back to the copy until the table holds whole reservations', async () => {
    findMany.mockResolvedValue([row('r1', null)])
    const copy = [{ id: 'r1', status: 'reserved' }]
    expect(await loadScreenReservations(copy)).toBe(copy)
  })
})
