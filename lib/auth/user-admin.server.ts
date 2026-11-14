import 'server-only'

import { userAccessChangeViolation } from './access-control'
import { getAccessRoleMap } from './access-roles.server'
import { userCan } from './can'

/**
 * Refuses (403) a user-account change that a user manager (HR) may not make
 * — see userAccessChangeViolation. The Director is never refused here.
 */
export async function assertUserAccessChange(
  actor: { role?: string | null },
  target: { role?: string | null } | null,
  next?: { role?: string | null; modules?: readonly string[] | null; actsAsTechnician?: boolean | null; accessRoleId?: string | null },
): Promise<void> {
  let resolved: Parameters<typeof userAccessChangeViolation>[0]['next']
  if (next) {
    if (next.accessRoleId) {
      const custom = (await getAccessRoleMap()).get(next.accessRoleId)
      if (!custom) throw Object.assign(new Error('That role no longer exists'), { status: 400 })
      resolved = {
        role: custom.baseRole,
        actsAsTechnician: next.actsAsTechnician,
        grantsUserAdmin: custom.permissions.includes('manageUsers') || custom.permissions.includes('manageRoles'),
      }
    } else {
      resolved = {
        role: next.role,
        modules: next.modules,
        actsAsTechnician: next.actsAsTechnician,
        grantsUserAdmin: !!next.role && (userCan({ role: next.role }, 'manageUsers') || userCan({ role: next.role }, 'manageRoles')),
      }
    }
  }
  const reason = userAccessChangeViolation({ actor, target, next: resolved })
  if (reason) throw Object.assign(new Error(reason), { status: 403 })
}
