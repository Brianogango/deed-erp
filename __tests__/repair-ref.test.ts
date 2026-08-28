import { describe, expect, it } from 'vitest'
import {
  findRepairByPortalRef,
  inferredTemporaryRepairRef,
  isOfficialRepairRef,
  isTemporaryRepairRef,
} from '@/lib/repair-ref'

describe('repair refs', () => {
  it('classifies sequential vs timestamp tickets', () => {
    expect(isOfficialRepairRef('REP/0275')).toBe(true)
    expect(isOfficialRepairRef('REP/2099/0001')).toBe(true)
    expect(isOfficialRepairRef('REP-227532')).toBe(false)
    expect(isTemporaryRepairRef('REP-227532')).toBe(true)
    expect(isTemporaryRepairRef('REP/0275')).toBe(false)
  })

  it('reconstructs the timestamp ticket from Fiona Akoth intake time', () => {
    expect(inferredTemporaryRepairRef('2026-08-17T10:57:07.532Z')).toBe('REP-227532')
  })

  it('resolves a shared timestamp URL onto the sequential job', () => {
    const repairs = [
      { id: 'old', ref: 'REP-111111', intakeDate: '2026-06-01T00:00:00.000Z' },
      {
        id: 'ec234fcd-3e99-4570-961a-51bb88eb2b28',
        ref: 'REP/0275',
        intakeDate: '2026-08-17T10:57:07.532Z',
        previousRefs: ['REP-227532'],
      },
    ]
    expect(findRepairByPortalRef(repairs, 'REP-227532')?.ref).toBe('REP/0275')
    expect(findRepairByPortalRef(repairs, 'REP%2F0275')?.ref).toBe('REP/0275')
    expect(findRepairByPortalRef(repairs, 'REP/0275')?.ref).toBe('REP/0275')
  })

  it('does not steal a live timestamp ticket that is still the official ref', () => {
    const repairs = [
      { id: 'live', ref: 'REP-227532', intakeDate: '2026-08-17T10:57:07.532Z' },
      { id: 'newer', ref: 'REP/0275', intakeDate: '2026-08-17T10:57:07.532Z' },
    ]
    expect(findRepairByPortalRef(repairs, 'REP-227532')?.id).toBe('live')
  })

  it('infers the timestamp alias when previousRefs were never stored', () => {
    const repairs = [
      { id: 'job', ref: 'REP/0275', intakeDate: '2026-08-17T10:57:07.532Z' },
    ]
    expect(findRepairByPortalRef(repairs, 'REP-227532')?.id).toBe('job')
  })
})
