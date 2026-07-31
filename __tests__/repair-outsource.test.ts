import { describe, it, expect } from 'vitest'
import { repairOutsourceReadiness, repairHasLoggedDiagnosis, repairIsAssignedForOutsource } from '@/lib/repair-outsource'

describe('repairOutsourceReadiness', () => {
  it('blocks when no technician is assigned', () => {
    const result = repairOutsourceReadiness({
      diagnosis: { findings: 'Board short', faultDescription: 'No power' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/assign a technician/i)
  })

  it('blocks when diagnosis is missing on diagnosis_first', () => {
    const result = repairOutsourceReadiness({
      assignedTechnicianId: 'tech-1',
      repairPath: 'diagnosis_first',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/log a diagnosis/i)
  })

  it('blocks when diagnosis fields are blank on diagnosis_first', () => {
    const result = repairOutsourceReadiness({
      assignedTechnicianId: 'tech-1',
      diagnosis: { findings: '  ', faultDescription: '' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/log a diagnosis/i)
  })

  it('allows outsourcing when assigned and diagnosed', () => {
    const result = repairOutsourceReadiness({
      assignedTechnicianId: 'tech-1',
      diagnosis: { findings: 'Failed charger IC', faultDescription: 'No power' },
    })
    expect(result).toEqual({ ok: true })
  })

  it('allows direct_repair outsourcing with assignment only', () => {
    const result = repairOutsourceReadiness({
      assignedTechnicianId: 'tech-1',
      repairPath: 'direct_repair',
    })
    expect(result).toEqual({ ok: true })
  })

  it('helpers match the readiness rules', () => {
    expect(repairIsAssignedForOutsource({ assignedTechnicianId: 'x' })).toBe(true)
    expect(repairIsAssignedForOutsource({})).toBe(false)
    expect(repairHasLoggedDiagnosis({ diagnosis: { faultDescription: 'Dead' } })).toBe(true)
    expect(repairHasLoggedDiagnosis({ diagnosis: { findings: '', faultDescription: null } })).toBe(false)
  })
})
