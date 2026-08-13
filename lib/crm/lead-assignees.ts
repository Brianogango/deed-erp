/**
 * Roles eligible to own CRM leads / appear in assign dropdowns / inbox round-robin.
 * Directors must be included — production only has one sales_rep, so a sales-only
 * pool always auto-assigned every inbound lead to that rep.
 */
export const LEAD_ASSIGNEE_ROLES = ['director', 'sales_rep', 'sales'] as const

export type LeadAssigneeRole = (typeof LEAD_ASSIGNEE_ROLES)[number]

export function isLeadAssigneeRole(role: string | null | undefined): boolean {
  if (!role) return false
  return (LEAD_ASSIGNEE_ROLES as readonly string[]).includes(role)
}
