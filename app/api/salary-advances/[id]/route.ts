import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { toClientAdvance, toDbAdvance } from '@/lib/hr/salary-advance-store'

const HR_ROLES = ['director', 'finance_officer']
const PAY_ROLES = ['director', 'finance_officer']

// Salary advance lifecycle transitions. Amounts and status changes are validated
// server-side and gated by role. The payroll engine also PUTs deduction/recovery
// updates here when a run consumes an advance.
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const existing = await prisma.salaryAdvance.findUnique({ where: { id: params.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const action = String(body.action ?? 'update')
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)
    const isPay = isRoleAllowed(session.user.role, PAY_ROLES)

    // ── Explicit lifecycle actions (validated) ──────────────────────────────────
    if (action === 'decide') {
      if (!isHr) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (existing.status !== 'pending') return NextResponse.json({ error: 'Advance already reviewed' }, { status: 409 })
      const approved = !!body.approved
      const row = await prisma.salaryAdvance.update({
        where: { id: params.id },
        data: { status: approved ? 'approved' : 'rejected', approvedByUserId: session.user.id, approvedByName: session.user.name, decisionDate: new Date(), decisionNote: body.note ?? null },
      })
      await writeFinancialAudit({ userId: session.user.id, action: 'salary_advance_decide', entityType: 'salary_advance', entityId: row.id, newValues: { status: row.status } })
      return NextResponse.json(toClientAdvance(row))
    }
    if (action === 'pay') {
      if (!isPay) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (existing.status !== 'approved') return NextResponse.json({ error: 'Only approved advances can be paid' }, { status: 409 })
      const row = await prisma.salaryAdvance.update({
        where: { id: params.id },
        data: { status: 'paid', paidDate: body.paidDate ? new Date(body.paidDate) : new Date(), outstandingAmount: existing.outstandingAmount ?? existing.amount },
      })
      await writeFinancialAudit({ userId: session.user.id, action: 'salary_advance_paid', entityType: 'salary_advance', entityId: row.id })
      return NextResponse.json(toClientAdvance(row))
    }
    if (action === 'cancel') {
      const isOwner = existing.createdByUserId === session.user.id
      if (!isOwner && !isHr) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (existing.status !== 'pending') return NextResponse.json({ error: 'Only pending advances can be cancelled' }, { status: 409 })
      const row = await prisma.salaryAdvance.update({ where: { id: params.id }, data: { status: 'cancelled' } })
      await writeFinancialAudit({ userId: session.user.id, action: 'salary_advance_cancel', entityType: 'salary_advance', entityId: row.id })
      return NextResponse.json(toClientAdvance(row))
    }

    // ── Payroll-driven recovery update (deductions / outstanding / repaid) ──────
    // Only finance/HR (who run payroll) may write recovery fields.
    if (!isHr) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const patch = toDbAdvance({
      deductions: body.deductions,
      amountRecovered: body.amountRecovered,
      outstandingAmount: body.outstandingAmount,
      status: body.status,
    })
    const row = await prisma.salaryAdvance.update({ where: { id: params.id }, data: patch as any })
    return NextResponse.json(toClientAdvance(row))
  })
}

export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  return PUT(request, ctx)
}
