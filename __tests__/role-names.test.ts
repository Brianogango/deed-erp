import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { storedRoleNames } from '@/lib/auth/authorization'
import { isLeadAssigneeRole } from '@/lib/crm/lead-assignees'
import { userIdsWithRoles } from '@/lib/in-app-notifications'

describe('role names', () => {
  it('a database lookup by role also matches the old names', () => {
    expect(storedRoleNames(['finance_officer']).sort()).toEqual(['finance', 'finance_officer'])
    expect(storedRoleNames(['director']).sort()).toEqual(['admin', 'director', 'super_admin'])
    expect(storedRoleNames(['sales_rep', 'technical_lead']).sort()).toEqual(['lead_tech', 'sales', 'sales_rep', 'technical_lead'])
    expect(storedRoleNames(['finance']).sort()).toEqual(['finance', 'finance_officer'])
    expect(storedRoleNames(['admin_officer'])).toEqual(['admin_officer'])
  })

  it('browser-side recipient and lead checks accept old names', () => {
    const users = [{ id: 'a', role: 'finance' }, { id: 'b', role: 'finance_officer' }, { id: 'c', role: 'sales' }]
    expect(userIdsWithRoles(users, ['finance_officer']).sort()).toEqual(['a', 'b'])
    expect(isLeadAssigneeRole('sales')).toBe(true)
    expect(isLeadAssigneeRole('sales_rep')).toBe(true)
    expect(isLeadAssigneeRole('technician')).toBe(false)
  })
})
