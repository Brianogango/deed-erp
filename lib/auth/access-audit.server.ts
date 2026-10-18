import 'server-only'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { describeAccessDiff, diffAccess, snapshotAccess, type AccessSnapshot } from './access-control'
import { describeRoleDiff, diffRoles, type AccessRole } from './access-roles'

export type AccessAuditAction = 'user.created' | 'user.access_changed' | 'user.deactivated' | 'user.reactivated' | 'user.deleted'

export type RoleAuditAction = 'role.created' | 'role.updated' | 'role.deleted'

export const ACCESS_AUDIT_ACTIONS: Array<AccessAuditAction | RoleAuditAction> = [
  'user.created', 'user.access_changed', 'user.deactivated', 'user.reactivated', 'user.deleted',
  'role.created', 'role.updated', 'role.deleted',
]
export const ACCESS_AUDIT_ENTITY_TYPES = ['user', 'access_role']

type Person = { id: string; name?: string | null; username?: string | null }

/**
 * Keeps a permanent record of who changed whose access, from what, to what.
 * Written to audit_logs (shown to Directors in Settings). A failure here is
 * logged but never undoes the change — the person has already been updated,
 * and a missing history line is better than a half-applied access change.
 */
export async function recordAccessChange(args: {
  action: AccessAuditAction
  actor: Person
  target: Person
  before: Partial<AccessSnapshot> | null
  after: Partial<AccessSnapshot> | null
}): Promise<void> {
  try {
    const before = args.before ? snapshotAccess(args.before) : null
    const after = args.after ? snapshotAccess(args.after) : null
    const diff = before && after ? diffAccess(before, after) : null
    await writeFinancialAudit({
      userId: args.actor.id,
      action: args.action,
      entityType: 'user',
      entityId: args.target.id,
      oldValues: before,
      newValues: {
        ...(after ?? {}),
        targetName: args.target.name ?? args.target.username ?? '',
        actorName: args.actor.name ?? args.actor.username ?? '',
        summary: diff ? describeAccessDiff(diff) : args.action.replace('user.', '').replace('_', ' '),
      },
    })
  } catch (error) {
    console.error('[access-audit] could not record an access change:', error instanceof Error ? error.message : error)
  }
}

type RoleFields = Pick<AccessRole, 'name' | 'baseRole' | 'modules' | 'permissions'>

/** Same idea for the roles themselves: who created, changed or deleted which role, and what changed. */
export async function recordRoleChange(args: {
  action: RoleAuditAction
  actor: Person
  role: { id: string; name: string }
  before: RoleFields | null
  after: RoleFields | null
  affectedUsers?: number
}): Promise<void> {
  try {
    const diff = args.before && args.after ? diffRoles(args.before, args.after) : null
    const summary = args.action === 'role.created'
      ? `created with ${args.after?.permissions.length ?? 0} permissions in ${args.after?.modules.length ?? 0} modules`
      : args.action === 'role.deleted'
        ? 'deleted'
        : describeRoleDiff(diff!)
    await writeFinancialAudit({
      userId: args.actor.id,
      action: args.action,
      entityType: 'access_role',
      entityId: args.role.id,
      oldValues: args.before,
      newValues: {
        ...(args.after ?? {}),
        targetName: args.role.name,
        actorName: args.actor.name ?? args.actor.username ?? '',
        summary: args.affectedUsers ? `${summary} (${args.affectedUsers} ${args.affectedUsers === 1 ? 'person' : 'people'} on this role)` : summary,
      },
    })
  } catch (error) {
    console.error('[access-audit] could not record a role change:', error instanceof Error ? error.message : error)
  }
}
