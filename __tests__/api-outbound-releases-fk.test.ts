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

  it('links the serial register when the unit came out of Deed stock', async () => {
    const res = await post({ clientId: CLIENT, repairId: REPAIR, serials: [{ serialNumberId: SERIAL, expectedSerial: 'SN1' }] })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.items.create[0]).toMatchObject({
      serialNumberId: SERIAL,
      expectedSerial: 'SN1',
    })
  })
})

describe('POST /api/outbound-releases — devices Deed never sold', () => {
  it('releases a repaired customer-owned device with no register entry', async () => {
    // This is the majority of repairs. Requiring a serial_numbers row refused
    // every one of them: the device was never Deed stock and never will be.
    const res = await post({
      clientId: CLIENT,
      repairId: REPAIR,
      serials: [{ expectedSerial: 'CUSTOMER-OWNED-SN' }],
    })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.items.create[0]).toMatchObject({
      serialNumberId: null,
      expectedSerial: 'CUSTOMER-OWNED-SN',
    })
  })

  it('accepts a device identifier when the customer device has no serial at all', async () => {
    const res = await post({
      clientId: CLIENT,
      repairId: REPAIR,
      serials: [{ expectedSerial: 'HP EliteBook 840 (no serial)' }],
    })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.items.create[0].serialNumberId).toBeNull()
  })

  it('still requires something identifying to hand over', async () => {
    // Verification compares what the storekeeper reads off the device against
    // this, so a blank line would make the check meaningless.
    const res = await post({ clientId: CLIENT, repairId: REPAIR, serials: [{ expectedSerial: '   ' }] })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('serial or device identifier') })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('still refuses an unregistered unit on a sale, where stock must decrement', async () => {
    const INVOICE = '44444444-4444-4444-8444-444444444444'
    const res = await post({ clientId: CLIENT, invoiceId: INVOICE, serials: [{ expectedSerial: 'NO-SERIAL-ROW' }] })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('NO-SERIAL-ROW') })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('trims the identifier it stores', async () => {
    const res = await post({ clientId: CLIENT, repairId: REPAIR, serials: [{ expectedSerial: '  SN-7  ' }] })
    expect(res.status).toBe(201)
    expect(mockCreate.mock.calls[0][0].data.items.create[0].expectedSerial).toBe('SN-7')
  })
})
