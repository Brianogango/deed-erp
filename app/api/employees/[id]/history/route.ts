import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer', 'finance_officer']
const ACTIONS = ['create_employee', 'change_employee_salary', 'exit_employee']

/** Salary and status changes for one employee, newest first, from the audit log. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'employee', entityId: id, action: { in: ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { username: true } } },
    })
    return NextResponse.json(rows.map(r => ({
      id: String(r.id),
      action: r.action,
      at: r.createdAt.toISOString(),
      by: r.user?.username ?? '',
      oldValues: r.oldValues ?? null,
      newValues: r.newValues ?? null,
    })))
  })
}
