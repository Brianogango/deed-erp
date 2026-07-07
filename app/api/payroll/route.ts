import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'
import type { PayrollRun, Payslip } from '@/lib/store'

const PAYROLL_ROLES = ['director', 'admin_officer', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(PAYROLL_ROLES)
    const state = await loadAppState()
    const runs: PayrollRun[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as PayrollRun[] : []
    const payslips: Payslip[] = Array.isArray(state['deed_payslips']) ? state['deed_payslips'] as Payslip[] : []
    return NextResponse.json({ runs, payslips })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(PAYROLL_ROLES)
    const body = await request.json()
    const state = await loadAppState()
    if (body.run) {
      const runs: PayrollRun[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as PayrollRun[] : []
      // A newly submitted run always starts unapproved — the client cannot
      // create a run that is already 'approved' or 'posted'.
      const run: PayrollRun = { ...body.run, status: 'pending_approval' }
      runs.unshift(run)
      await saveStoreKeys({ deed_payrollRuns: JSON.stringify(runs) })
      await writeFinancialAudit({
        userId: actor.id,
        action: 'create_payroll_run',
        entityType: 'payroll_run',
        entityId: run.id,
        newValues: { ref: run.ref, totalNet: run.totalNet, month: run.month, year: run.year },
      })
    }
    if (body.payslips && Array.isArray(body.payslips)) {
      const payslips: Payslip[] = Array.isArray(state['deed_payslips']) ? state['deed_payslips'] as Payslip[] : []
      const newPayslips = [...body.payslips, ...payslips]
      await saveStoreKeys({ deed_payslips: JSON.stringify(newPayslips) })
    }
    return NextResponse.json({ ok: true })
  })
}
