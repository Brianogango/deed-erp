import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

// Advance a payroll run's status. Totals/lines are computed at creation and are
// never rewritten here — only a forward status transition (+ posted journal id).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval'],
  pending_approval: ['approved'],
  approved: ['posted'],
  posted: [],
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await prisma.payrollRun.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nextStatus = body.status as string | undefined
  if (nextStatus !== undefined && nextStatus !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? []
    if (!allowed.includes(nextStatus)) {
      return NextResponse.json({ error: `Illegal payroll status change: ${existing.status} → ${nextStatus}` }, { status: 409 })
    }
  }

  const data: Record<string, unknown> = {}
  if (nextStatus !== undefined) data.status = nextStatus
  if (nextStatus === 'approved') { data.approvedById = /^[0-9a-f-]{36}$/i.test(session.user.id) ? session.user.id : null; data.approvedAt = new Date() }
  if (typeof body.postedJournalId === 'string') data.postedJournalId = body.postedJournalId

  const updated = await prisma.payrollRun.update({ where: { id: params.id }, data: data as any })

  // Publish payslips when the run is posted.
  if (nextStatus === 'posted') {
    await prisma.payslip.updateMany({ where: { payrollRunId: params.id }, data: { status: 'published' } })
  }

  await writeFinancialAudit({
    userId: session.user.id,
    action: nextStatus === 'posted' ? 'post_payroll' : nextStatus === 'approved' ? 'approve_payroll' : 'update_payroll_run',
    entityType: 'payroll_run',
    entityId: params.id,
    oldValues: { status: existing.status },
    newValues: { status: updated.status },
  })

  return NextResponse.json({ item: { id: updated.id, status: updated.status } })
}

export async function PATCH(request: NextRequest, ctx: { params: { id: string } }) {
  return PUT(request, ctx)
}
