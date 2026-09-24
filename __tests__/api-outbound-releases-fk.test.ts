import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireRole, mockCreate, mockRepairFindUnique, mockInvoiceFindUnique, mockNextRef } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCreate: vi.fn(),
  mockRepairFindUnique: vi.fn(),
  mockInvoiceFindUnique: vi.fn(),
  mockNextRef: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  requireRole: mockRequireRole,
  getRequiredSession: vi.fn(),
  withApiErrorHandling: (fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    outboundRelease: { create: mockCreate, findMany: vi.fn() },
    repair: { findUnique: mockRepairFindUnique },
    invoice: { findUnique: mockInvoiceFindUnique },
  },
}))
vi.mock('@/lib/orc-ref-counter', () => ({ getNextOrcRef: mockNextRef }))

import { POST } from '@/app/api/outbound-releases/route'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const REPAIR = '22222222-2222-4222-8222-222222222222'
const SERIAL = '33333333-3333-4333-8333-333333333333'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/outbound-releases', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'user-1', role: 'director' })
  mockNextRef.mockResolvedValue('ORC/2026/0001')
  mockCreate.mockResolvedValue({ id: 'rel-1' })
  mockRepairFindUnique.mockResolvedValue(null)
  mockInvoiceFindUnique.mockResolvedValue(null)
})

describe('POST /api/outbound-releases FK guards', () => {
  it('does not send a blank clientId to a uuid column', async () => {
    // A walk-in repair stores customerId as '' — this used to reach Postgres
    // as `invalid input syntax for type uuid` and 500 the release.
    const res = await post({ clientId: '   ', repairId: REPAIR, serials: [{ serialNumberId: SERIAL, expectedSerial: 'SN1' }] })
    expect(res.status).toBe(422)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('falls back to the source repair’s client when the body has none', async () => {
    mockRepairFindUnique.mockResolvedValue({ clientId: CLIENT })
    const res = await post({ clientId: 'not-a-uuid', repairId: REPAIR, serials: [{ serialNumberId: SERIAL, expectedSerial: 'SN1' }] })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.clientId).toBe(CLIENT)
  })

  it('refuses a unit with no serial register entry instead of dropping the required column', async () => {
    const res = await post({ clientId: CLIENT, repairId: REPAIR, serials: [{ expectedSerial: 'NO-SERIAL-ROW' }] })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('NO-SERIAL-ROW') })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('always writes serialNumberId when it creates items', async () => {
    const res = await post({ clientId: CLIENT, repairId: REPAIR, serials: [{ serialNumberId: SERIAL, expectedSerial: 'SN1' }] })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.items.create[0]).toMatchObject({
      serialNumberId: SERIAL,
      expectedSerial: 'SN1',
    })
  })
})
