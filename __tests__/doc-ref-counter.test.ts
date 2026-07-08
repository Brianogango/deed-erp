import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }))

vi.mock('@/lib/auth/db', () => ({ sql: mockSql }))

import { getNextDocNumber } from '@/lib/doc-ref-counter'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getNextDocNumber()', () => {
  it('increments an existing counter atomically', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)                              // CREATE TABLE
      .mockResolvedValueOnce({ rows: [{ current_value: 42 }] })      // UPDATE ... RETURNING

    const num = await getNextDocNumber('invoice')
    expect(num).toBe('INV-00042')
  })

  it('seeds from the highest existing document number on first use', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)                              // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })                           // UPDATE (no counter row yet)
      .mockResolvedValueOnce({ rows: [{ max_num: 88 }] })            // seed query
      .mockResolvedValueOnce({ rows: [{ current_value: 89 }] })      // INSERT ... RETURNING

    const num = await getNextDocNumber('quote')
    expect(num).toBe('QTE-00089')
  })

  it('starts at 1 when no documents exist', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_num: 0 }] })
      .mockResolvedValueOnce({ rows: [{ current_value: 1 }] })

    const num = await getNextDocNumber('sale_order')
    expect(num).toBe('SO-00001')
  })

  it('throws when the counter cannot be generated', async () => {
    mockSql
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ max_num: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(getNextDocNumber('client')).rejects.toThrow()
  })
})
