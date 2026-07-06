import 'server-only'
import prisma from '@/lib/prisma'
import { isUUID } from '@/lib/utils'

/**
 * Append an immutable row to the Prisma `audit_logs` table for a financial
 * mutation (invoice void, payment, deposit change, payroll post, portal
 * auto-payment, ...). Audit logging must never block or fail the underlying
 * operation, so any error here is swallowed after being logged server-side.
 */
export async function writeFinancialAudit(params: {
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
  ipAddress?: string | null
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId && isUUID(params.userId) ? params.userId : null,
        action: params.action.slice(0, 100),
        entityType: params.entityType.slice(0, 60),
        entityId: params.entityId && isUUID(params.entityId) ? params.entityId : null,
        oldValues: (params.oldValues ?? undefined) as any,
        newValues: (params.newValues ?? undefined) as any,
        ipAddress: params.ipAddress ?? null,
      },
    })
  } catch (err) {
    console.error('[finance-audit] failed to write audit row:', err)
  }
}
