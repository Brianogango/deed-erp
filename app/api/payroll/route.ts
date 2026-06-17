import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { PayrollRun, Payslip } from '@/lib/store'

const PAYROLL_ROLES = ['director', 'finance_officer']

export async function GET() {
  try {
    await requireRole(PAYROLL_ROLES)
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
  const state = await loadAppState()
  const runs: PayrollRun[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as PayrollRun[] : []
  const payslips: Payslip[] = Array.isArray(state['deed_payslips']) ? state['deed_payslips'] as Payslip[] : []
  return NextResponse.json({ runs, payslips })
}

export async function POST(request: Request) {
  try {
    await requireRole(PAYROLL_ROLES)
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
  const body = await request.json()
  const state = await loadAppState()
  if (body.run) {
    const runs: PayrollRun[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as PayrollRun[] : []
    runs.unshift(body.run)
    await saveStoreKeys({ deed_payrollRuns: JSON.stringify(runs) })
  }
  if (body.payslips && Array.isArray(body.payslips)) {
    const payslips: Payslip[] = Array.isArray(state['deed_payslips']) ? state['deed_payslips'] as Payslip[] : []
    const newPayslips = [...body.payslips, ...payslips]
    await saveStoreKeys({ deed_payslips: JSON.stringify(newPayslips) })
  }
  return NextResponse.json({ ok: true })
}
