import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']

/**
 * Change the monthly repayment, or close the loan early (settled in cash or written off).
 * Closing needs a reason and is audited; it does not post any journal.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const loan = await prisma.employeeLoan.findUnique({ where: { id } })
    if (!loan) return NextResponse.json({ error: 'Loan not found' }, { status: 404 })
    if (loan.isCleared) return NextResponse.json({ error: 'This loan is already closed' }, { status: 409 })

    if (body.action === 'close') {
      const reason = String(body.reason ?? '').trim().slice(0, 300)
      if (!reason) return NextResponse.json({ error: 'Say why the loan is being closed (settled in cash, written off, etc.)' }, { status: 400 })
      await prisma.employeeLoan.update({ where: { id }, data: { isCleared: true, outstanding: 0 } })
      await writeFinancialAudit({
        userId: actor.id, action: 'close_employee_loan', entityType: 'employee', entityId: loan.employeeId,
        oldValues: { outstanding: Number(loan.outstanding) }, approvalReason: reason,
      })
      return NextResponse.json({ ok: true })
    }

    const monthly = Math.round((Number(body.monthlyDeduction) || 0) * 100) / 100
    if (!(monthly > 0) || monthly > Number(loan.outstanding)) {
      return NextResponse.json({ error: 'The repayment must be more than zero and not more than what is still owed' }, { status: 400 })
    }
    await prisma.employeeLoan.update({ where: { id }, data: { monthlyDeduction: monthly } })
    await writeFinancialAudit({
      userId: actor.id, action: 'change_employee_loan_repayment', entityType: 'employee', entityId: loan.employeeId,
      oldValues: { monthlyDeduction: Number(loan.monthlyDeduction) }, newValues: { monthlyDeduction: monthly },
    })
    return NextResponse.json({ ok: true })
  })
}
