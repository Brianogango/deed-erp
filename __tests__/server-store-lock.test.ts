import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockWithDbTransaction, mockClientQuery } = vi.hoisted(() => ({
  mockWithDbTransaction: vi.fn(),
  mockClientQuery: vi.fn(),
}))

vi.mock('@/lib/auth/db', () => ({
  sql: vi.fn(),
  withDbTransaction: mockWithDbTransaction,
}))

vi.mock('@/lib/blob-store', () => ({
  isBlobKey: () => false,
  readBlob: vi.fn(),
  writeBlob: vi.fn(),
}))

import { withAppStateKeyLock } from '@/lib/server-store'

beforeEach(() => {
  vi.clearAllMocks()
  mockWithDbTransaction.mockImplementation(async (fn: any) => fn({ query: mockClientQuery }))
})

describe('withAppStateKeyLock', () => {
  it('acquires a transaction-scoped advisory lock keyed by the collection name before running fn', async () => {
    const fn = vi.fn().mockResolvedValue('result')
    const result = await withAppStateKeyLock('deed_deliveries', fn)
    expect(result).toBe('result')
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['deed_deliveries'],
    )
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('propagates fn errors after the lock is released (transaction rolled back)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    mockWithDbTransaction.mockImplementation(async (cb: any) => {
      try {
        return await cb({ query: mockClientQuery })
      } catch (err) {
        throw err
      }
    })
    await expect(withAppStateKeyLock('deed_deliveries', fn)).rejects.toThrow('boom')
  })

  it('fails open (still runs fn) when the lock infrastructure itself is unavailable', async () => {
    mockWithDbTransaction.mockRejectedValue(new Error('no database url'))
    const fn = vi.fn().mockResolvedValue('ran anyway')
    const result = await withAppStateKeyLock('deed_deliveries', fn)
    expect(result).toBe('ran anyway')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
