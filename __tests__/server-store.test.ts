import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures the variable is available when vi.mock() factory runs
// (vi.mock is hoisted to the top of the file by Vitest's transformer).
const { mockSql } = vi.hoisted(() => {
  const mockSql = vi.fn()
  return { mockSql }
})

vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))

import { loadAppState, saveStoreKeys } from '@/lib/server-store'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadAppState()', () => {
  it('returns empty object when table has no rows', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)        // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({ rows: [] })     // SELECT

    const state = await loadAppState()
    expect(state).toEqual({})
  })

  it('parses JSON string values', async () => {
    mockSql
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
  it('calls upsert for each key', async () => {
    mockSql.mockResolvedValue(undefined)

    await saveStoreKeys({
      deed_contacts: '[{"id":"1"}]',
      deed_products: '[{"id":"2"}]',
    })

    // ensureTable (1) + 2 upserts = 3 calls
    expect(mockSql).toHaveBeenCalledTimes(3)
  })

  it('does not throw when DB fails (swallows error)', async () => {
    mockSql.mockRejectedValue(new Error('write failed'))

    await expect(saveStoreKeys({ some_key: 'value' })).resolves.toBeUndefined()
  })
})
