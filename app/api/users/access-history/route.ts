/**
 * GET — who changed whose access, newest first. Directors only (manageUsers).
 * Reads the audit_logs rows written by lib/auth/access-audit.server.ts.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { ACCESS_AUDIT_ACTIONS } from '@/lib/auth/access-audit.server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('manageUsers')
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')
    const rows = await prisma.auditLog.findMany({
      where: {
        entityType: 'user',
        action: { in: ACCESS_AUDIT_ACTIONS },
        ...(userId ? { entityId: userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({
      entries: rows.map(row => {
        const after = (row.newValues ?? {}) as Record<string, unknown>
        return {
          id: String(row.id),
          at: row.createdAt.toISOString(),
          action: row.action,
          actor: String(after.actorName ?? '') || 'Unknown',
          target: String(after.targetName ?? '') || row.entityKey || '',
          targetId: row.entityId,
          summary: String(after.summary ?? row.action),
        }
      }),
    })
  })
}
