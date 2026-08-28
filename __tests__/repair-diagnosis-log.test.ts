import { describe, expect, it } from 'vitest'
import { applyLoggedDiagnosis, nextStatusAfterDiagnosis } from '@/lib/repair-diagnosis-log'

const diagnosis = {
  findings: 'Blown capacitor on power board',
  faultDescription: 'Mainboard power failure',
  diagnosedDate: '2026-08-28T12:00:00.000Z',
  revision: 1,
  revisionType: 'initial' as const,
}

describe('nextStatusAfterDiagnosis', () => {
  it('advances assigned and received to diagnosed on first log and on revision', () => {
    expect(nextStatusAfterDiagnosis('assigned', false)).toBe('diagnosed')
    expect(nextStatusAfterDiagnosis('assigned', true)).toBe('diagnosed')
    expect(nextStatusAfterDiagnosis('received', false)).toBe('diagnosed')
  })

  it('keeps a later status when revising', () => {
    expect(nextStatusAfterDiagnosis('in_repair', true)).toBe('in_repair')
    expect(nextStatusAfterDiagnosis('in_repair', false)).toBe('diagnosed')
  })
})

describe('applyLoggedDiagnosis', () => {
  it('keeps findings when warranty coverage is applied in the same write', () => {
    const repair = {
      status: 'assigned',
      partsUsed: undefined as unknown[] | undefined,
      underWarranty: true,
      warrantyCoverage: 'full' as const,
    }
    const next = applyLoggedDiagnosis(repair, diagnosis, { warrantyCoverage: 'partial' }, 'Jane Tech')
    expect(next.status).toBe('diagnosed')
    expect(next.diagnosis).toEqual(diagnosis)
    expect(next.warrantyCoverage).toBe('partial')
    expect(next.diagnosis.findings).toContain('Blown capacitor')
  })

  it('preserves diagnosis when a later patch is merged onto the logged row', () => {
    const assigned = { id: 'r1', status: 'assigned', underWarranty: true, warrantyCoverage: 'full' as const }
    const afterLog = applyLoggedDiagnosis(assigned, diagnosis, undefined, 'Jane Tech')
    const patched = { ...afterLog, warrantyCoverage: 'partial' as const }
    expect(patched.status).toBe('diagnosed')
    expect(patched.diagnosis).toEqual(diagnosis)
  })
})
