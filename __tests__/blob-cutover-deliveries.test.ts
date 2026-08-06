import { describe, expect, it } from 'vitest'
import { domainRoleFor, isDualWriteKey, BLOB_SOT_KEYS } from '@/lib/blob-cutover'

describe('blob cutover — deliveries dual-write', () => {
  it('treats deed_deliveries as dual_write (not blob_sot)', () => {
    expect(domainRoleFor('deed_deliveries')).toBe('dual_write')
    expect(isDualWriteKey('deed_deliveries')).toBe(true)
    expect((BLOB_SOT_KEYS as readonly string[]).includes('deed_deliveries')).toBe(false)
  })
})
