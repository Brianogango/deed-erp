import 'server-only'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { describeAccessDiff, diffAccess, snapshotAccess, type AccessSnapshot } from './access-control'

export type AccessAuditAction = 'user.created' | 'user.access_changed' | 'user.deactivated' | 'user.reactivated' | 'user.deleted'

export const ACCESS_AUDIT_ACTIONS: AccessAuditAction[] = ['user.created', 'user.access_changed', 'user.deactivated', 'user.reactivated', 'user.deleted']

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
