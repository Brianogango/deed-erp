import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { runToClient, payslipToClient, createRunFromClient } from '@/lib/hr/payroll-store'

const PAYROLL_ROLES = ['director', 'admin_officer', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(PAYROLL_ROLES)
    const [runs, payslips] = await Promise.all([
      prisma.payrollRun.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.payslip.findMany({ include: { payrollRun: { select: { periodMonth: true, periodYear: true } } } }),
    ])
    return NextResponse.json({
      runs: runs.map(r => runToClient(r, payslips)),
      payslips: payslips.map(payslipToClient),
    })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(PAYROLL_ROLES)
    const body = await request.json()
    if (body.run) {
      // Idempotent: skip if a run with this reference already exists.
      const existing = await prisma.payrollRun.findUnique({ where: { runReference: body.run.ref } }).catch(() => null)
      if (!existing) {
        const created = await createRunFromClient(body.run, Array.isArray(body.payslips) ? body.payslips : [], actor.id)
        await writeFinancialAudit({
          userId: actor.id,
          action: 'create_payroll_run',
          entityType: 'payroll_run',
          entityId: created.id,
          newValues: { ref: created.runReference, totalNet: Number(created.totalNet), month: created.periodMonth, year: created.periodYear },
        })
      }
    }
    return NextResponse.json({ ok: true })
  })
}
