import { describe, expect, it } from 'vitest'
import {
  domainRoleFor,
  isDualWriteKey,
  BLOB_SOT_KEYS,
  DUAL_WRITE_BLOB_KEYS,
} from '@/lib/blob-cutover'

describe('blob cutover — inventory dual-write', () => {
  const inventoryKeys = [
    'deed_deliveries',
    'deed_serials',
    'deed_stockMoves',
    'deed_purchaseOrders',
    'deed_receipts',
    'deed_bulkStock',
  ] as const

  it('treats inventory domains as dual_write (not blob_sot)', () => {
    for (const key of inventoryKeys) {
      expect(domainRoleFor(key)).toBe('dual_write')
      expect(isDualWriteKey(key)).toBe(true)
      expect((BLOB_SOT_KEYS as readonly string[]).includes(key)).toBe(false)
      expect((DUAL_WRITE_BLOB_KEYS as readonly string[]).includes(key)).toBe(true)
    }
  })

  it('has no remaining blob_sot inventory keys', () => {
    expect(BLOB_SOT_KEYS).toEqual([])
  })
})
