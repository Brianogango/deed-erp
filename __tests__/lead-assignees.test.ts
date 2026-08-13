import { describe, expect, it } from 'vitest'
import { isLeadAssigneeRole, LEAD_ASSIGNEE_ROLES } from '@/lib/crm/lead-assignees'

describe('lead assignees', () => {
  it('includes directors so inbound leads are not stuck on the sole sales_rep', () => {
    expect(LEAD_ASSIGNEE_ROLES).toContain('director')
    expect(LEAD_ASSIGNEE_ROLES).toContain('sales_rep')
    expect(isLeadAssigneeRole('director')).toBe(true)
    expect(isLeadAssigneeRole('sales_rep')).toBe(true)
    expect(isLeadAssigneeRole('finance_officer')).toBe(false)
  })
})
