
/**
 * Who may see and change a lead. Before this, any signed-in user (a
 * technician included) could list every lead, and any rep could edit or
 * delete a colleague's.
 */

type LeadLike = { ownerId?: string | null; stage?: string | null }

export function leadRole(role: unknown): string | null {
  const r = canonicalUserRole(String(role ?? ''))
  return r && userCan({ role: r }, 'sales.leads.edit') ? r : null
}

/** Reps see their own leads and unassigned ones (so they can pick them up). */
export function canSeeLead(role: unknown, userId: string, lead: LeadLike): boolean {
  const r = leadRole(role)
  if (!r) return false
  if (userCan({ role: r }, 'sales.view_all')) return true
  return !lead.ownerId || lead.ownerId === userId
}

export const canEditLead = canSeeLead

/** Directors and admin officers; a rep only their own lead that has not become a deal. */
export function canDeleteLead(role: unknown, userId: string, lead: LeadLike): boolean {
  const r = leadRole(role)
  if (!r) return false
  if (userCan({ role: r }, 'sales.crm.assign')) return true
  return !userCan({ role: r }, 'sales.view_all') && lead.ownerId === userId && lead.stage !== 'converted'
}

/** Reps cannot hand a lead to someone else; only managers assign. */
export function canAssignLead(role: unknown): boolean {
  const r = leadRole(role)
  return Boolean(r && userCan({ role: r }, 'sales.crm.assign'))
}

export function leadListWhere(role: unknown, userId: string) {
  const r = leadRole(role)
  return r && !userCan({ role: r }, 'sales.view_all') ? { OR: [{ ownerId: userId }, { ownerId: null }] } : {}
}

export { phoneKey } from '@/lib/crm/phone-key'
import { canonicalUserRole } from '@/lib/auth/roles'
import { userCan } from '@/lib/auth/can'
