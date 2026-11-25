import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockEnqueue = vi.fn()
const mockLoadForWrite = vi.fn()
const mockMirrorDeliveries = vi.fn()
const mockMirrorKnownDomain = vi.fn()
const mockMirrorRepairs = vi.fn()
const mockWriteStoreRecords = vi.fn()

vi.mock('@/lib/infra/jobs', () => ({
  enqueueDurableJob: (...args: unknown[]) => mockEnqueue(...args),
}))
vi.mock('@/lib/server-store', () => ({
  loadAppStateForWrite: (...args: unknown[]) => mockLoadForWrite(...args),
}))
vi.mock('@/lib/delivery-mirror', () => ({
  mirrorDeliveriesToPrisma: (...args: unknown[]) => mockMirrorDeliveries(...args),
}))
vi.mock('@/lib/blob-transfer', () => ({
  mirrorKnownDomain: (...args: unknown[]) => mockMirrorKnownDomain(...args),
}))
vi.mock('@/lib/repair-mirror', () => ({
  mirrorRepairsToPrisma: (...args: unknown[]) => mockMirrorRepairs(...args),
}))
vi.mock('@/lib/prisma-store', () => ({
  writeStoreRecords: (...args: unknown[]) => mockWriteStoreRecords(...args),
}))

import {
  enqueueMirrorRetry,
  runMirrorStoreKeyJob,
  MIRROR_STORE_KEY_JOB,
  STORE_RECORDS_SENTINEL,
} from '@/lib/store-mirror-jobs'

beforeEach(() => {
  for (const m of [mockEnqueue, mockLoadForWrite, mockMirrorDeliveries, mockMirrorKnownDomain, mockMirrorRepairs, mockWriteStoreRecords]) m.mockReset()
  mockEnqueue.mockResolvedValue({ id: 'job' })
  mockMirrorKnownDomain.mockResolvedValue({ upserted: 3, skipped: 0 })
  mockMirrorRepairs.mockResolvedValue({ mirrored: 2, skipped: 0 })
})

describe('enqueueMirrorRetry', () => {
  it('queues one coalesced job per store key', async () => {
    await enqueueMirrorRetry({ key: 'deed_deliveries', error: new Error('db down') })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const input = mockEnqueue.mock.calls[0][0]
    expect(input.type).toBe(MIRROR_STORE_KEY_JOB)
    expect(input.uniqueKey).toBe(`${MIRROR_STORE_KEY_JOB}:deed_deliveries`)
  })

  it('carries only the key, never the value that failed to mirror', async () => {
    // Replaying a stale snapshot would resurrect rows later saves superseded,
    // so the payload must not contain one.
    await enqueueMirrorRetry({ key: 'deed_deliveries', error: new Error('boom') })
    const payload = mockEnqueue.mock.calls[0][0].payload
    expect(payload).toEqual({ key: 'deed_deliveries', keys: null, lastError: 'boom' })
    expect(JSON.stringify(payload)).not.toContain('[')
  })

  it('never throws when the queue itself is unavailable', async () => {
    // The authoritative row is already committed; failing the save because the
    // retry bookkeeping could not be written would be worse than degrading to
    // the old logged-error behaviour.
    mockEnqueue.mockRejectedValueOnce(new Error('queue unreachable'))
    await expect(enqueueMirrorRetry({ key: 'deed_deliveries', error: new Error('x') })).resolves.toBeUndefined()
  })
})

describe('runMirrorStoreKeyJob', () => {
  it('re-reads current state rather than any snapshot, then mirrors it', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_deliveries: '[{"id":"d1"},{"id":"d2"}]' })
    const result = await runMirrorStoreKeyJob({ key: 'deed_deliveries' })
    expect(mockLoadForWrite).toHaveBeenCalledWith(['deed_deliveries'])
    expect(mockMirrorDeliveries).toHaveBeenCalledWith([{ id: 'd1' }, { id: 'd2' }])
    expect(result).toEqual({ key: 'deed_deliveries', mirrored: 2 })
  })

  it('mirrors purchase orders through the known-domain path', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_purchaseOrders: '[{"id":"po1"}]' })
    const result = await runMirrorStoreKeyJob({ key: 'deed_purchaseOrders' })
    expect(mockMirrorKnownDomain).toHaveBeenCalledWith('deed_purchaseOrders', '[{"id":"po1"}]', null)
    expect(result.mirrored).toBe(3)
  })

  it('throws when the table could not hold some rows, so the job retries', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_purchaseOrders: '[{"id":"po1"}]' })
    mockMirrorKnownDomain.mockResolvedValueOnce({ upserted: 0, skipped: 2 })
    await expect(runMirrorStoreKeyJob({ key: 'deed_purchaseOrders' })).rejects.toThrow(/2 row\(s\)/)
  })

  it('throws when the mirror reports an error', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_purchaseOrders: '[{"id":"po1"}]' })
    mockMirrorKnownDomain.mockResolvedValueOnce({ upserted: 0, skipped: 0, error: 'fk violation' })
    await expect(runMirrorStoreKeyJob({ key: 'deed_purchaseOrders' })).rejects.toThrow(/fk violation/)
  })

  it('re-mirrors repairs', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_repairs_v2: '[{"id":"r1"},{"id":"r2"}]' })
    const result = await runMirrorStoreKeyJob({ key: 'deed_repairs_v2' })
    expect(mockMirrorRepairs).toHaveBeenCalled()
    expect(result.mirrored).toBe(2)
  })

  it('re-writes store_records for the keys that were in the failed batch', async () => {
    mockLoadForWrite.mockResolvedValue({ deed_serials: '[{"id":"s1"}]', deed_receipts: '[]' })
    const result = await runMirrorStoreKeyJob({
      key: STORE_RECORDS_SENTINEL,
      keys: ['deed_serials', 'deed_receipts'],
    })
    expect(mockLoadForWrite).toHaveBeenCalledWith(['deed_serials', 'deed_receipts'])
    expect(mockWriteStoreRecords).toHaveBeenCalledWith({ deed_serials: '[{"id":"s1"}]', deed_receipts: '[]' })
    expect(result.mirrored).toBe(2)
  })

  it('is a no-op when the key now holds nothing', async () => {
    mockLoadForWrite.mockResolvedValue({})
    const result = await runMirrorStoreKeyJob({ key: 'deed_deliveries' })
    expect(mockMirrorDeliveries).not.toHaveBeenCalled()
    expect(result.mirrored).toBe(0)
  })

  it('rejects a job with no key, and an unregistered key', async () => {
    await expect(runMirrorStoreKeyJob({})).rejects.toThrow(/no key/)
    mockLoadForWrite.mockResolvedValue({ deed_whatever: '[]' })
    await expect(runMirrorStoreKeyJob({ key: 'deed_whatever' })).rejects.toThrow(/No mirror registered/)
  })
})
