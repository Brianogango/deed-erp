import { describe, expect, it } from 'vitest'
import {
  allocateRepairRef,
  findRepairByPortalRef,
  inferredTemporaryRepairRef,
  isOfficialRepairRef,
  isRandomRepairRef,
  isSequentialRepairRef,
  isTemporaryRepairRef,
  mintRandomRepairRef,
  takenRepairRefs,
} from '@/lib/repair-ref'

describe('repair refs', () => {
  it('classifies sequential, random, and timestamp tickets', () => {
    expect(isOfficialRepairRef('REP/0275')).toBe(true)
    expect(isOfficialRepairRef('REP/2099/0001')).toBe(true)
    expect(isOfficialRepairRef('REP-7K3M9X2Q')).toBe(true)
    expect(isSequentialRepairRef('REP/0275')).toBe(true)
    expect(isRandomRepairRef('REP-7K3M9X2Q')).toBe(true)
    expect(isOfficialRepairRef('REP-227532')).toBe(false)
    expect(isTemporaryRepairRef('REP-227532')).toBe(true)
    expect(isTemporaryRepairRef('REP/0275')).toBe(false)
    expect(isTemporaryRepairRef('REP-7K3M9X2Q')).toBe(false)
  })

  it('mints an 8-character Crockford ticket from entropy', () => {
    const ref = mintRandomRepairRef(() => Uint8Array.from([0, 1, 31, 16, 8, 9, 10, 11]))
    expect(ref).toBe('REP-23ZJABCD')
    expect(isRandomRepairRef(ref)).toBe(true)
  })

  it('does not emit consecutive sequence numbers', () => {
    const first = allocateRepairRef()
    const second = allocateRepairRef([first])
    expect(isRandomRepairRef(first)).toBe(true)
    expect(isRandomRepairRef(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(second).not.toMatch(/^REP\/0*2$/i)
  })

  it('retries when a random ticket is already taken', () => {
    const taken = ['REP-22222222']
    const bytes = [
      Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    ]
    let calls = 0
    const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    globalThis.crypto.getRandomValues = ((array: Uint8Array) => {
      const next = bytes[Math.min(calls, bytes.length - 1)]!
      calls += 1
      array.set(next)
      return array
    }) as typeof globalThis.crypto.getRandomValues
    try {
      const ref = allocateRepairRef(taken)
      expect(ref).toBe('REP-3456789A')
      expect(calls).toBeGreaterThan(1)
    } finally {
      globalThis.crypto.getRandomValues = original
    }
  })

  it('collects official and previous refs as taken', () => {
    expect(takenRepairRefs([
      { ref: 'REP/0275', previousRefs: ['REP-227532'] },
      { ref: 'REP-7K3M9X2Q' },
    ])).toEqual(['REP/0275', 'REP-227532', 'REP-7K3M9X2Q'])
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
