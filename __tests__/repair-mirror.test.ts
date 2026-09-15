import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockLoadAppState, mockSaveStoreKeys, mockResolveClientId } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    invoice: { findUnique: vi.fn() },
    repair: { upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
  },
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockResolveClientId: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState, saveStoreKeys: mockSaveStoreKeys }))
vi.mock('@/lib/legacy-compat', () => ({ resolveClientId: mockResolveClientId }))

import { mirrorRepairsToPrisma } from '@/lib/repair-mirror'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT_ID = '22222222-2222-4222-8222-222222222222'
const REPAIR_ID = '33333333-3333-4333-8333-333333333333'

const blobRepair = {
  id: REPAIR_ID,
  ref: 'REP/0042',
  status: 'in_repair',
  customerId: 'legacy-1',
  customerName: 'Jane Doe',
  customerPhone: '0712345678',
  productName: 'HP EliteBook 840',
  serialNumber: 'SN-123',
  issueDescription: 'No power',
  intakeChannel: 'walk_in',
  intakeDate: '2026-07-01',
  laborCost: 3000,
  partsUsed: [{ qty: 2, price: 1500 }],
  quote: { total: 6960 },
  accessories: [{ name: 'Charger', received: true }],
  priority: 'high',
  createdBy: USER_ID,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPrisma.user.findFirst.mockResolvedValue({ id: USER_ID })
  mockPrisma.user.findMany.mockResolvedValue([{ id: USER_ID }])
  mockPrisma.invoice.findUnique.mockResolvedValue(null)
  mockPrisma.repair.upsert.mockResolvedValue({})
  mockPrisma.repair.findUnique.mockResolvedValue(null)
  mockPrisma.repair.update.mockResolvedValue({})
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
})

describe('mirrorRepairsToPrisma()', () => {
  it('updates by id when the repair was renumbered after its first mirror', async () => {
    // REP-445447 was mirrored, then renumbered REP/0306 — the row exists with
    // the blob id under the OLD job number. Upsert-by-jobNumber deadlocks
    // (jobNumber misses, id collides); the mirror must update by id instead.
    mockPrisma.repair.findUnique.mockResolvedValue({ id: REPAIR_ID })
    const result = await mirrorRepairsToPrisma([{ ...blobRepair, ref: 'REP/0306' }])
    expect(result.mirrored).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockPrisma.repair.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: REPAIR_ID },
      data: expect.objectContaining({ jobNumber: 'REP/0306' }),
    }))
    expect(mockPrisma.repair.upsert).not.toHaveBeenCalled()
  })

  it('upserts core repair fields keyed by job number', async () => {
    const result = await mirrorRepairsToPrisma([blobRepair])
    expect(result.mirrored).toBe(1)
    expect(mockPrisma.repair.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobNumber: 'REP/0042' },
      create: expect.objectContaining({
        id: REPAIR_ID,
        jobNumber: 'REP/0042',
        clientId: CLIENT_ID,
        status: 'in_repair',
        deviceType: 'HP EliteBook 840',
        reportedFault: 'No power',
        labourCost: 3000,
        partsCost: 3000,
        estimatedCost: 6960,
        priority: 'high',
        accessoriesIn: ['Charger'],
      }),
    }))
  })

  it('maps blob-only statuses onto the relational enum', async () => {
    await mirrorRepairsToPrisma([
      { ...blobRepair, ref: 'REP/0001', status: 'awaiting_approval' },
      { ...blobRepair, ref: 'REP/0002', status: 'invoiced' },
      { ...blobRepair, ref: 'REP/0003', status: 'closed' },
      { ...blobRepair, ref: 'REP/0004', status: 'declined' },
    ])
    const statuses = mockPrisma.repair.upsert.mock.calls.map((c: any) => c[0].update.status)
    expect(statuses).toEqual(['diagnosis', 'ready', 'collected', 'cancelled'])
  })

  it('skips repairs whose fingerprint has not changed', async () => {
    const first = await mirrorRepairsToPrisma([blobRepair])
    expect(first.mirrored).toBe(1)
    // Persisted hashes returned on the next run
    const savedHashes = JSON.parse(mockSaveStoreKeys.mock.calls[0][0]['repair_mirror_hashes_v1'])
    mockLoadAppState.mockResolvedValue({ repair_mirror_hashes_v1: savedHashes })

    const second = await mirrorRepairsToPrisma([blobRepair])
    expect(second.mirrored).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it('remirrors when a job is marked no-charge even if status is unchanged', async () => {
    const first = await mirrorRepairsToPrisma([blobRepair])
    expect(first.mirrored).toBe(1)
    const savedHashes = JSON.parse(mockSaveStoreKeys.mock.calls[0][0]['repair_mirror_hashes_v1'])
    mockLoadAppState.mockResolvedValue({ repair_mirror_hashes_v1: savedHashes })
    mockPrisma.repair.upsert.mockClear()

    const second = await mirrorRepairsToPrisma([{
      ...blobRepair,
      billingExempt: true,
      billingExemptAt: '2026-09-15T11:00:00Z',
    }])
    expect(second.skipped).toBe(0)
    expect(second.mirrored).toBe(1)
    expect(mockPrisma.repair.upsert).toHaveBeenCalled()
    const payload = mockPrisma.repair.upsert.mock.calls[0][0].update.payload
    expect(payload.billingExempt).toBe(true)
  })

  it('only links invoices that exist in the relational table', async () => {
    const invoiceId = '44444444-4444-4444-8444-444444444444'
    mockPrisma.invoice.findUnique.mockResolvedValue(null)
    await mirrorRepairsToPrisma([{ ...blobRepair, invoiceId }])
    expect(mockPrisma.repair.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ invoiceId: null }),
    }))
  })

  it('continues past individual failures', async () => {
    mockPrisma.repair.upsert
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({})
    const result = await mirrorRepairsToPrisma([
      { ...blobRepair, ref: 'REP/0010' },
      { ...blobRepair, ref: 'REP/0011' },
    ])
    expect(result.failed).toBe(1)
    expect(result.mirrored).toBe(1)
  })

  it('re-runs from fresh state when a write lands mid-pass instead of dropping it', async () => {
    // The blob store is re-read for the trailing rerun while the mirror-state
    // hash lookup keeps its own answer.
    mockLoadAppState.mockImplementation((keys?: string[]) =>
      keys?.[0] === 'deed_repairs_v2'
        ? Promise.resolve({ deed_repairs_v2: [blobRepair] })
        : Promise.resolve({}),
    )

    // Hold the first pass inside its upsert so the second call lands mid-pass.
    let releaseUpsert!: (value: unknown) => void
    mockPrisma.repair.upsert.mockImplementationOnce(
      () => new Promise(resolve => { releaseUpsert = resolve }),
    )

    const first = mirrorRepairsToPrisma([blobRepair])
    await vi.waitFor(() => expect(mockPrisma.repair.upsert).toHaveBeenCalledTimes(1))

    // Mid-pass write: returns immediately without mirroring, queues the rerun.
    const dropped = await mirrorRepairsToPrisma([{ ...blobRepair, status: 'approved' }])
    expect(dropped).toEqual({ mirrored: 0, skipped: 0, failed: 0 })

    releaseUpsert({})
    await first

    // Trailing pass re-mirrored from the re-read blob state.
    expect(mockPrisma.repair.upsert).toHaveBeenCalledTimes(2)
  })
})
