import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { PayrollRun, Payslip } from '@/lib/store'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const state = await loadAppState()
  const runs: PayrollRun[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as PayrollRun[] : []
  const payslips: Payslip[] = Array.isArray(state['deed_payslips']) ? state['deed_payslips'] as Payslip[] : []
  return NextResponse.json({ runs, payslips })
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
