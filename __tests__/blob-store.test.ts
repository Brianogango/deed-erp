import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const BLOB_TMP = mkdtempSync(path.join(tmpdir(), 'deed-blobs-'))
process.env.BLOB_STORE_DIR = BLOB_TMP

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }))
const { mockPrismaStore } = vi.hoisted(() => ({
  mockPrismaStore: {
    storeBackend: vi.fn(() => 'dual' as const),
    writeStoreRecords: vi.fn().mockResolvedValue(undefined),
    readStoreRecords: vi.fn().mockResolvedValue({}),
    storeRecordVersion: vi.fn().mockResolvedValue({ latest: '', n: 0 }),
    loadStoreRecordChangesSince: vi.fn().mockResolvedValue({ changes: {}, latestUpdatedAt: '' }),
    latestStoreRecordUpdatedAt: vi.fn().mockResolvedValue(''),
  },
}))
vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))
vi.mock('@/lib/prisma-store', () => mockPrismaStore)

import { isBlobKey, readBlob, writeBlob } from '@/lib/blob-store'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrismaStore.storeBackend.mockReturnValue('dual')
  mockPrismaStore.readStoreRecords.mockResolvedValue({})
  mockPrismaStore.writeStoreRecords.mockResolvedValue(undefined)
})

afterAll(() => {
  rmSync(BLOB_TMP, { recursive: true, force: true })
})

describe('blob-store', () => {
  it('classifies binary payload keys', () => {
    expect(isBlobKey('expense_receipt_abc')).toBe(true)
    expect(isBlobKey('repair_photos_REP-123')).toBe(true)
    expect(isBlobKey('repair_payment_proof_REP-123')).toBe(true)
    expect(isBlobKey('product_photos_abc')).toBe(true)
    expect(isBlobKey('deed_invoices')).toBe(false)
    expect(isBlobKey('deed_repairs_v2')).toBe(false)
  })

  it('round-trips a blob through the filesystem', async () => {
    await writeBlob('expense_receipt_test1', 'data:image/png;base64,AAAA')
    expect(await readBlob('expense_receipt_test1')).toBe('data:image/png;base64,AAAA')
  })

  it('returns null for a missing blob', async () => {
    expect(await readBlob('expense_receipt_missing')).toBeNull()
  })

  it('sanitizes hostile keys so they cannot escape the blob dir', async () => {
    await writeBlob('expense_receipt_../../etc/passwd', 'safe')
    expect(await readBlob('expense_receipt_../../etc/passwd')).toBe('safe')
  })
})

describe('server-store blob integration', () => {
  it('saveStoreKeys writes blob keys to disk and NOT to app_state', async () => {
    mockSql.mockResolvedValue({ rows: [] })
    await saveStoreKeys({ expense_receipt_int1: 'data:application/pdf;base64,BBBB' })
    // ensureTable calls only — no upsert since every entry was a blob.
    for (const call of mockSql.mock.calls) {
      const text = String(call[0])
      expect(text).not.toContain('INSERT INTO app_state')
    }
    expect(await readBlob('expense_receipt_int1')).toBe('data:application/pdf;base64,BBBB')
  })

  it('saveStoreKeys still upserts regular keys alongside blob keys', async () => {
    mockSql.mockResolvedValue({ rows: [] })
    await saveStoreKeys({ deed_contacts: '[]', expense_receipt_int2: 'data:image/png;base64,CC' })
    const upsert = mockSql.mock.calls.find(c => String(c[0]).includes('INSERT INTO app_state'))
    expect(upsert).toBeDefined()
    // Tagged-template args: [strings, now, keysArray, valuesArray]
    expect(upsert![2]).toEqual(['deed_contacts'])
  })

  it('loadAppState overlays blob values from disk for requested keys', async () => {
    await writeBlob('repair_photos_REP-777', JSON.stringify([{ id: 'p1', url: 'x' }]))
    mockSql.mockResolvedValue({ rows: [] })
    const state = await loadAppState(['repair_photos_REP-777'])
    expect(state['repair_photos_REP-777']).toEqual([{ id: 'p1', url: 'x' }])
  })

  it('loadAppState falls back to the legacy app_state row when no file exists', async () => {
    mockSql
      .mockResolvedValueOnce(undefined) // CREATE TABLE
      .mockResolvedValueOnce(undefined) // CREATE INDEX
      .mockResolvedValueOnce({ rows: [{ key: 'expense_receipt_legacy', value: 'data:image/jpg;base64,DD' }] })
    const state = await loadAppState(['expense_receipt_legacy'])
    expect(state['expense_receipt_legacy']).toBe('data:image/jpg;base64,DD')
  })
})
