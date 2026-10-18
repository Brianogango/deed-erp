import { describe, expect, it } from 'vitest'
import {
  LAST_DIRECTOR_MESSAGE,
  describeAccessDiff,
  diffAccess,
  lastDirectorViolation,
  modulesOutsideRole,
  snapshotAccess,
} from '@/lib/auth/access-control'

const user = (over: Partial<ReturnType<typeof snapshotAccess>> = {}) => snapshotAccess({ role: 'sales_rep', modules: ['sales', 'crm'], active: true, ...over })

describe('access change diff', () => {
  it('reports what changed, and nothing when nothing did', () => {
    expect(diffAccess(user(), user()).changed).toBe(false)
    const diff = diffAccess(user(), user({ role: 'finance_officer', modules: ['sales', 'accounting'], active: false }))
    expect(diff.role).toEqual({ from: 'sales_rep', to: 'finance_officer' })
    expect(diff.modulesAdded).toEqual(['accounting'])
    expect(diff.modulesRemoved).toEqual(['crm'])
    expect(diff.active).toEqual({ from: true, to: false })
    expect(describeAccessDiff(diff)).toBe('role sales rep → finance officer; deactivated; gained accounting; lost crm')
  })

  it('ignores the order modules are listed in', () => {
    expect(diffAccess(user({ modules: ['crm', 'sales'] }), user({ modules: ['sales', 'crm'] })).changed).toBe(false)
  })
})

describe('never leaving the company without a Director', () => {
  const users = [
    { id: 'd1', role: 'director', active: true },
    { id: 'd2', role: 'director', active: true },
    { id: 's1', role: 'sales_rep', active: true },
  ]

  it('allows changes while another active Director remains', () => {
    expect(lastDirectorViolation(users, 'd1', { role: 'sales_rep' })).toBeNull()
    expect(lastDirectorViolation(users, 'd1', { active: false })).toBeNull()
    expect(lastDirectorViolation(users, 'd2', { removed: true })).toBeNull()
  })

  it('refuses to demote, deactivate or delete the last active Director', () => {
    const solo = [{ id: 'd1', role: 'director', active: true }, { id: 'd2', role: 'director', active: false }, users[2]]
    expect(lastDirectorViolation(solo, 'd1', { role: 'finance_officer' })).toBe(LAST_DIRECTOR_MESSAGE)
    expect(lastDirectorViolation(solo, 'd1', { active: false })).toBe(LAST_DIRECTOR_MESSAGE)
    expect(lastDirectorViolation(solo, 'd1', { removed: true })).toBe(LAST_DIRECTOR_MESSAGE)
  })

  it('counts the old names for Director and does not block unrelated users', () => {
    const solo = [{ id: 'a1', role: 'super_admin', active: true }, users[2]]
    expect(lastDirectorViolation(solo, 'a1', { role: 'sales_rep' })).toBe(LAST_DIRECTOR_MESSAGE)
    expect(lastDirectorViolation(solo, 's1', { active: false })).toBeNull()
  })

  it('does not block a company that already has no active Director, so it can be repaired', () => {
    expect(lastDirectorViolation([{ id: 's1', role: 'sales_rep', active: true }], 's1', { role: 'director' })).toBeNull()
  })
})

describe('modules beyond a role', () => {
  it('flags only modules the role does not normally open', () => {
    expect(modulesOutsideRole('sales_rep', ['dashboard', 'sales', 'crm', 'expenses'])).toEqual([])
    expect(modulesOutsideRole('sales_rep', ['sales', 'accounting', 'purchase'])).toEqual(['accounting', 'purchase'])
    expect(modulesOutsideRole('director', ['accounting'])).toEqual([])
  })
})
