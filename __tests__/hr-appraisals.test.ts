import { describe, expect, it } from 'vitest'
import { canAcknowledge, canManagerAssess, canSelfAssess, deriveFinalRating, sanitizeGoals, weightedScore } from '@/lib/hr/appraisals'

describe('appraisal scoring', () => {
  it('weights goal scores and normalises weights', () => {
    const goals = [
      { id: 'a', title: 'Sales', weight: 60, managerScore: 5 },
      { id: 'b', title: 'Reports', weight: 40, managerScore: 3 },
    ]
    expect(weightedScore(goals, 'managerScore')).toBe(4.2)
    expect(weightedScore([{ id: 'a', title: 'x', weight: 0, selfScore: 4 }, { id: 'b', title: 'y', weight: 0, selfScore: 2 }], 'selfScore')).toBe(3)
    expect(weightedScore(goals, 'selfScore')).toBeNull()
  })

  it('takes the final rating from the manager, then goal scores, then the self-rating', () => {
    expect(deriveFinalRating({ managerRating: 4, selfRating: 5, goals: [] })).toBe(4)
    expect(deriveFinalRating({ goals: [{ id: 'a', title: 'x', weight: 50, managerScore: 5 }, { id: 'b', title: 'y', weight: 50, managerScore: 4 }] })).toBe(5)
    expect(deriveFinalRating({ selfRating: 3, goals: [] })).toBe(3)
    expect(deriveFinalRating({ goals: [] })).toBeNull()
  })

  it('cleans goals from the client', () => {
    const goals = sanitizeGoals([
      { id: 'a', title: '  Close deals ', weight: 150, selfScore: 6 },
      { title: '', weight: 10 },
      { title: 'Training', weight: -5, managerScore: 4 },
    ])
    expect(goals).toEqual([{ id: 'a', title: 'Close deals', weight: 100 }, { id: 'g2', title: 'Training', weight: 0, managerScore: 4 }])
    expect(sanitizeGoals('nope')).toEqual([])
    expect(sanitizeGoals(Array.from({ length: 30 }, (_, i) => ({ title: `G${i}`, weight: 1 })))).toHaveLength(12)
  })
})

describe('who can act on an appraisal', () => {
  const a = { employeeId: 'emp', managerEmployeeId: 'mgr', status: 'pending_self' as const }
  it('only the employee writes the self-assessment', () => {
    expect(canSelfAssess(a, { employeeId: 'emp', isHr: false })).toBe(true)
    expect(canSelfAssess(a, { employeeId: 'mgr', isHr: true })).toBe(false)
    expect(canSelfAssess({ ...a, status: 'pending_manager' }, { employeeId: 'emp', isHr: false })).toBe(false)
  })
  it('the manager or HR reviews, but nobody reviews themselves', () => {
    const p = { ...a, status: 'pending_manager' as const }
    expect(canManagerAssess(p, { employeeId: 'mgr', isHr: false })).toBe(true)
    expect(canManagerAssess(p, { employeeId: 'other', isHr: true })).toBe(true)
    expect(canManagerAssess(p, { employeeId: 'other', isHr: false })).toBe(false)
    expect(canManagerAssess(p, { employeeId: 'emp', isHr: true })).toBe(false)
  })
  it('the employee acknowledges a completed review once', () => {
    const c = { ...a, status: 'completed' as const }
    expect(canAcknowledge(c, { employeeId: 'emp', isHr: false })).toBe(true)
    expect(canAcknowledge({ ...c, employeeAckAt: '2026-10-01' }, { employeeId: 'emp', isHr: false })).toBe(false)
    expect(canAcknowledge(c, { employeeId: 'mgr', isHr: true })).toBe(false)
  })
})
