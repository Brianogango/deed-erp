import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDb, mockPrisma } = vi.hoisted(() => {
  const db = {
    user: { findMany: vi.fn() },
    notificationEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    notificationRecipient: { createMany: vi.fn() },
    notificationOutbox: { create: vi.fn() },
  }
  return {
    mockDb: db,
    mockPrisma: { ...db, $transaction: vi.fn((fn: (tx: any) => unknown) => fn(db)) },
  }
})

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { publishNotificationEvent, clampIdempotencyKey } from '@/lib/notifications/service'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.notificationEvent.findUnique.mockResolvedValue(null)
  mockDb.notificationEvent.create.mockResolvedValue({ id: 'evt-1' })
  mockDb.notificationRecipient.createMany.mockResolvedValue({ count: 0 })
  mockDb.notificationOutbox.create.mockResolvedValue({ id: 'out-1' })
})

const longName = 'Lenovo V14 G5 IRL 14 FHD '.repeat(20) // 500 chars

describe('publishNotificationEvent column clamps (P2000 regression)', () => {
  it('ellipsizes titles longer than the VarChar(240) column', async () => {
    await publishNotificationEvent({
      eventType: 'inventory.low_stock',
      entityType: 'product',
      entityId: 'p-1',
      title: `Low stock — ${longName}`,
      body: 'body',
      idempotencyKey: 'k1',
    })
    const data = mockDb.notificationEvent.create.mock.calls[0][0].data
    expect(data.title).toHaveLength(240)
    expect(data.title.endsWith('…')).toBe(true)
  })

  it('keeps over-long idempotency keys inside the column and unique', async () => {
    const makeKey = (id: string) =>
      `condition:inventory.valuation_exception:product:${id}:${'2026-09-01T00:00:00.000Z-'.repeat(8)}`
    const keyA = makeKey('a'.repeat(36))
    const keyB = makeKey('b'.repeat(36))
    expect(keyA.length).toBeGreaterThan(240)

    await publishNotificationEvent({
      eventType: 'inventory.valuation_exception',
      entityType: 'product',
      entityId: 'a'.repeat(36),
      title: 't',
      body: 'b',
      idempotencyKey: keyA,
    })
    const data = mockDb.notificationEvent.create.mock.calls[0][0].data
    expect(data.idempotencyKey.length).toBeLessThanOrEqual(240)
    // the lookup uses the same clamped key, so idempotency still works
    expect(mockDb.notificationEvent.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: data.idempotencyKey } })

    const clampedA = clampIdempotencyKey(keyA)
    const clampedB = clampIdempotencyKey(keyB)
    expect(clampedA).not.toBe(clampedB)
    expect(clampIdempotencyKey(keyA)).toBe(clampedA) // stable
  })

  it('leaves in-bounds input untouched', async () => {
    await publishNotificationEvent({
      eventType: 'inventory.low_stock',
      title: 'Low stock — Mouse',
      body: 'b',
      idempotencyKey: 'short-key',
    })
    const data = mockDb.notificationEvent.create.mock.calls[0][0].data
    expect(data.title).toBe('Low stock — Mouse')
    expect(data.idempotencyKey).toBe('short-key')
  })
})
