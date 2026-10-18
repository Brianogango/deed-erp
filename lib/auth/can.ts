/**
 * "Can this person do this?" — the one check the screens and the server share.
 *
 * A person on a custom role carries the exact list of permissions that role
 * holds (`permissions`). Everyone else is on a built-in role, whose rights are
 * the long-standing role rules, so nobody's access changes until they are
 * moved onto a custom role.
 */
import { PERMISSION_BY_KEY, PERMISSION_GROUPS } from './permission-catalog'
import type { PublicUser } from './types'

type Subject = Pick<PublicUser, 'role' | 'modules'> & { permissions?: readonly string[] | null }

const ALIASES: Record<string, string> = {
  super_admin: 'director', admin: 'director',
  finance: 'finance_officer', inventory: 'inventory_officer', kilimall: 'kilimall_officer',
  sales: 'sales_rep', lead_tech: 'technical_lead', repair_tech: 'technician',
}
const normalizeRole = (role: string | null | undefined) => (role ? (ALIASES[role] ?? role) : '')

const SELF_SERVICE = new Set(['hr', 'sops', 'sop_documents', 'expenses', 'leave', 'my_documents'])

export function userCan(user: Subject | null | undefined, key: string): boolean {
  if (!user) return false
  const def = PERMISSION_BY_KEY[key]
  if (!def) return false // an unknown permission is never granted
  if (Array.isArray(user.permissions)) return user.permissions.includes(key)
  if (normalizeRole(user.role) === 'director') return true
  if (def.builtIn === 'module') {
    const module = PERMISSION_GROUPS.find(g => g.id === def.group)?.module
    if (!module) return false
    return SELF_SERVICE.has(module) || (user.modules ?? []).includes(module)
  }
  return def.builtIn.includes(normalizeRole(user.role) as never)
}

export const userCanAny = (user: Subject | null | undefined, keys: readonly string[]) => keys.some(key => userCan(user, key))
