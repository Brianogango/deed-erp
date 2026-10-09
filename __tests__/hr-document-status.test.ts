import { describe, expect, it } from 'vitest'
import { documentExpiry, expiryCounts } from '@/lib/hr/document-status'

const today = new Date(2026, 9, 9) // 9 Oct 2026

describe('document expiry', () => {
  it('has no expiry when no date is set', () => {
    expect(documentExpiry(undefined, today)).toEqual({ status: 'active', daysLeft: null })
  })
  it('flags expired, expiring (within 60 days) and active', () => {
    expect(documentExpiry('2026-10-08', today).status).toBe('expired')
    expect(documentExpiry('2026-10-09', today)).toEqual({ status: 'expiring', daysLeft: 0 })
    expect(documentExpiry('2026-12-08', today).status).toBe('expiring')
    expect(documentExpiry('2026-12-09', today).status).toBe('active')
  })
  it('counts both kinds', () => {
    expect(expiryCounts([{ expiryDate: '2026-01-01' }, { expiryDate: '2026-11-01' }, { expiryDate: undefined }], today)).toEqual({ expiring: 1, expired: 1 })
  })
})
