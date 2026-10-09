import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { CpanelError, cpanelConfig, suspendMailbox } from '@/lib/integrations/cpanel-email'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer']

/** Blocks sign-in to the employee's work mailbox on exit. The mailbox and its mail are kept. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const cfg = cpanelConfig()
    if (!cfg) return NextResponse.json({ error: 'cPanel is not configured on the server.' }, { status: 503 })
    const employee = await prisma.employee.findUnique({ where: { id }, select: { workEmail: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!employee.workEmail) return NextResponse.json({ error: 'This employee has no work email recorded' }, { status: 400 })
    try {
      await suspendMailbox(cfg, employee.workEmail)
    } catch (e) {
      const status = e instanceof CpanelError ? e.status : 502
      return NextResponse.json({ error: e instanceof Error ? e.message : 'The mailbox could not be suspended' }, { status })
    }
    await writeFinancialAudit({
      userId: actor.id, action: 'suspend_work_mailbox', entityType: 'employee', entityId: id,
      oldValues: { email: employee.workEmail },
    })
    return NextResponse.json({ ok: true, email: employee.workEmail })
  })
}
