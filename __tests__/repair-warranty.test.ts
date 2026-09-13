import { describe, expect, it } from 'vitest'
import { findOpenRepairWithSerial, normalizeRepairSerial, resolveRepairWarranty, warrantyPatchFromDecision } from '@/lib/repair-warranty'

const active = {
  id: 'w1', ref: 'WAR/2026/0001', serialNumber: '5CG-123 ABC',
  startDate: '2026-01-01', endDate: '2026-12-31', status: 'active' as const,
}

describe('repair warranty resolution', () => {
  it('normalizes case, whitespace and separators', () => {
    expect(normalizeRepairSerial(' 5cg－123 abc ')).toBe('5CG123ABC')
    const result = resolveRepairWarranty([active], '5cg123-abc', { now: new Date('2026-09-13T12:00:00Z') })
    expect(result.covered).toBe(true)
    expect(result.warranty?.id).toBe('w1')
  })

  it('honours the full expiry day and rejects the following day', () => {
    expect(resolveRepairWarranty([active], active.serialNumber, { now: new Date('2026-12-31T20:00:00Z') }).covered).toBe(true)
    const expired = resolveRepairWarranty([active], active.serialNumber, { now: new Date('2027-01-01T00:00:00Z') })
    expect(expired.covered).toBe(false)
    expect(expired.reason).toBe('expired')
  })

  it('does not trust status without valid dates', () => {
    const result = resolveRepairWarranty([{ ...active, endDate: '' }], active.serialNumber)
    expect(result.covered).toBe(false)
    expect(result.reason).toBe('inactive')
  })

  it('accepts expiring records that are still within their dates', () => {
    const result = resolveRepairWarranty([{ ...active, status: 'expiring' }], active.serialNumber, { now: new Date('2026-09-13T12:00:00Z') })
    expect(result.covered).toBe(true)
  })

  it('forces manual review for an exception and excludes client damage', () => {
    expect(resolveRepairWarranty([active], active.serialNumber, { serialException: true }).verificationStatus).toBe('pending_manual_review')
    const damaged = resolveRepairWarranty([active], active.serialNumber, { clientCausedDamage: true })
    expect(warrantyPatchFromDecision(damaged)).toEqual(expect.objectContaining({
      underWarranty: false, warrantyVerificationStatus: 'excluded_client_damage',
    }))
  })

  it('detects formatted duplicates but permits closed repairs and the current row', () => {
    const repairs = [
      { id: 'open', serialNumber: '5CG-123 ABC', status: 'assigned' },
      { id: 'closed', serialNumber: 'OTHER-1', status: 'collected' },
    ]
    expect(findOpenRepairWithSerial(repairs, '5cg123abc')?.id).toBe('open')
    expect(findOpenRepairWithSerial(repairs, '5cg123abc', 'open')).toBeUndefined()
    expect(findOpenRepairWithSerial(repairs, 'other1')).toBeUndefined()
  })
})
