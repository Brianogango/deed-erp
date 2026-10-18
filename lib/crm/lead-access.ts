import { normalizePermissionRole } from '@/lib/auth/authorization'

/**
 * Who may see and change a lead. Before this, any signed-in user (a
 * technician included) could list every lead, and any rep could edit or
 * delete a colleague's.
 */
const LEAD_ROLES = new Set(['director', 'admin_officer', 'finance_officer', 'sales_rep'])
const MANAGERS = new Set(['director', 'admin_officer'])

type LeadLike = { ownerId?: string | null; stage?: string | null }

export function leadRole(role: unknown): string | null {
  const r = normalizePermissionRole(String(role ?? ''))
  return r && LEAD_ROLES.has(r) ? r : null
}

/** Reps see their own leads and unassigned ones (so they can pick them up). */
export function canSeeLead(role: unknown, userId: string, lead: LeadLike): boolean {
  const r = leadRole(role)
  if (!r) return false
  if (r !== 'sales_rep') return true
  return !lead.ownerId || lead.ownerId === userId
}

export const canEditLead = canSeeLead

/** Directors and admin officers; a rep only their own lead that has not become a deal. */
export function canDeleteLead(role: unknown, userId: string, lead: LeadLike): boolean {
  const r = leadRole(role)
  if (!r) return false
  if (MANAGERS.has(r)) return true
  return r === 'sales_rep' && lead.ownerId === userId && lead.stage !== 'converted'
}

/** Reps cannot hand a lead to someone else; only managers assign. */
export function canAssignLead(role: unknown): boolean {
  const r = leadRole(role)
  return Boolean(r && MANAGERS.has(r))
}

export function leadListWhere(role: unknown, userId: string) {
  return leadRole(role) === 'sales_rep' ? { OR: [{ ownerId: userId }, { ownerId: null }] } : {}
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Last nine digits: 0712 345 678, +254712345678 and 712345678 are one number. */
export function phoneKey(v: unknown): string | null {
  const d = digits(v)
  return d.length >= 9 ? d.slice(-9) : null
}
