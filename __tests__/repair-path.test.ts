import { describe, it, expect } from 'vitest'
import {
  isDirectRepairPath,
  normalizeRepairPath,
  quotableStatusesForPath,
  repairPathLabel,
  startableStatusesForPath,
} from '@/lib/repair-path'

describe('repair-path helpers', () => {
  it('normalizes unknown values to diagnosis_first', () => {
    expect(normalizeRepairPath(undefined)).toBe('diagnosis_first')
    expect(normalizeRepairPath('')).toBe('diagnosis_first')
    expect(normalizeRepairPath('direct_repair')).toBe('direct_repair')
  })

  it('labels paths for UI', () => {
    expect(repairPathLabel('direct_repair')).toBe('Direct Repair')
    expect(repairPathLabel(undefined)).toBe('Diagnosis First')
  })

  it('allows quoting from assigned only on direct_repair', () => {
    expect(quotableStatusesForPath('direct_repair')).toContain('assigned')
    expect(quotableStatusesForPath('diagnosis_first')).not.toContain('assigned')
    expect(quotableStatusesForPath('diagnosis_first')).toContain('qc')
    expect(quotableStatusesForPath('direct_repair')).toContain('qc')
  })

  it('allows start from assigned on direct_repair', () => {
    expect(startableStatusesForPath('direct_repair')).toEqual(
      expect.arrayContaining(['assigned', 'diagnosed', 'approved', 'awaiting_parts']),
    )
    expect(startableStatusesForPath('diagnosis_first')).toEqual(['approved', 'awaiting_parts'])
    expect(isDirectRepairPath('direct_repair')).toBe(true)
  })
})
