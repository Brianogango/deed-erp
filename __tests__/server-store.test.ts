import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures the variable is available when vi.mock() factory runs
// (vi.mock is hoisted to the top of the file by Vitest's transformer).
const { mockSql } = vi.hoisted(() => {
  const mockSql = vi.fn()
  return { mockSql }
})

const { mockPrismaStore } = vi.hoisted(() => ({
  mockPrismaStore: {
    storeBackend: vi.fn((): 'prisma' | 'dual' | 'app_state' => 'dual'),
    writeStoreRecords: vi.fn().mockResolvedValue(undefined),
    readStoreRecords: vi.fn().mockResolvedValue({}),
    storeRecordVersion: vi.fn().mockResolvedValue({ latest: '', n: 0 }),
    loadStoreRecordChangesSince: vi.fn().mockResolvedValue({ changes: {}, latestUpdatedAt: '' }),
    latestStoreRecordUpdatedAt: vi.fn().mockResolvedValue(''),
  },
}))

vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))
vi.mock('@/lib/prisma-store', () => mockPrismaStore)

import { loadAppState, saveStoreKeys } from '@/lib/server-store'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrismaStore.storeBackend.mockReturnValue('dual')
  mockPrismaStore.readStoreRecords.mockResolvedValue({})
  mockPrismaStore.writeStoreRecords.mockResolvedValue(undefined)
})

describe('loadAppState()', () => {
  it('returns empty object when table has no rows', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)        // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce(undefined)        // CREATE INDEX IF NOT EXISTS
      .mockResolvedValueOnce({ rows: [] })     // SELECT

    const state = await loadAppState()
    expect(state).toEqual({})
  })

  it('parses JSON string values', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          { key: 'deed_contacts', value: JSON.stringify([{ id: '1', name: 'ACME' }]) },
        ],
      })

    const state = await loadAppState()
    expect(state['deed_contacts']).toEqual([{ id: '1', name: 'ACME' }])
  })

  it('returns raw string when value is not valid JSON', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ key: 'plain_key', value: 'not json at all' }] })

    const state = await loadAppState()
    expect(state['plain_key']).toBe('not json at all')
  })

  it('returns empty object when DB throws', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB connection failed'))

    const state = await loadAppState()
    expect(state).toEqual({})
  })
})

describe('saveStoreKeys()', () => {
  it('upserts all keys in a single batched query', async () => {
    mockSql.mockResolvedValue(undefined)

    await saveStoreKeys({
      deed_contacts: '[{"id":"1"}]',
      deed_products: '[{"id":"2"}]',
    })

    // ensureTable (CREATE TABLE + CREATE INDEX) + 1 batched upsert = 3 calls
    expect(mockSql).toHaveBeenCalledTimes(3)
    const upsertCall = mockSql.mock.calls[2]
    // Tagged template call: values arrive as trailing args — keys and values arrays
    expect(upsertCall).toEqual(expect.arrayContaining([
      expect.arrayContaining(['deed_contacts', 'deed_products']),
      expect.arrayContaining(['[{"id":"1"}]', '[{"id":"2"}]']),
    ]))
  })

  it('does not throw when DB fails (swallows error)', async () => {
    mockSql.mockRejectedValue(new Error('write failed'))

    await expect(saveStoreKeys({ some_key: 'value' })).resolves.toBeUndefined()
  })

  it('writes Prisma store_records and skips app_state when STORE_BACKEND=prisma', async () => {
    mockPrismaStore.storeBackend.mockReturnValue('prisma')
    mockSql.mockResolvedValue(undefined)

    await saveStoreKeys({ deed_serials: '[{"id":"s1"}]' })

    expect(mockPrismaStore.writeStoreRecords).toHaveBeenCalledWith({ deed_serials: '[{"id":"s1"}]' })
    expect(mockSql.mock.calls.some(c => String(c[0]).includes('INSERT INTO app_state'))).toBe(false)
  })
})

describe('Prisma store overlay', () => {
  it('lets store_records win over legacy app_state on load', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ key: 'deed_serials', value: JSON.stringify([{ id: 'blob' }]) }],
      })
    mockPrismaStore.readStoreRecords.mockResolvedValue({
      deed_serials: [{ id: 'prisma' }],
    })

    const state = await loadAppState(['deed_serials'])
    expect(state['deed_serials']).toEqual([{ id: 'prisma' }])
  })
})
