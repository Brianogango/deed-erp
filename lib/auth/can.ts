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
import { canonicalRole } from './roles'

type Subject = {
  role?: string | null
  modules?: readonly string[] | null
  permissions?: readonly string[] | null
  /** The custom role holds exactly its list (no base-role fallback). */
  permissionsExact?: boolean | null
  /** users.acts_as_technician: passes wherever technicians do. */
  actsAsTechnician?: boolean | null
}


const SELF_SERVICE = new Set(['hr', 'sops', 'sop_documents', 'expenses', 'leave', 'my_documents'])

export function userCan(user: Subject | null | undefined, key: string): boolean {
  if (!user) return false
  const def = PERMISSION_BY_KEY[key]
  if (!def) return false // an unknown permission is never granted
  if (Array.isArray(user.permissions) && (user.permissions.includes(key) || !def.followsBaseRole || user.permissionsExact === true)) return user.permissions.includes(key)
  const role = canonicalRole(user.role)
  if (role === 'director') return true
  if (def.builtIn === 'module') {
    const module = PERMISSION_GROUPS.find(g => g.id === def.group)?.module
    if (!module) return false
    return SELF_SERVICE.has(module) || (user.modules ?? []).includes(module)
  }
  return def.builtIn.includes(role as never) || (user.actsAsTechnician === true && def.builtIn.includes('technician'))
}

