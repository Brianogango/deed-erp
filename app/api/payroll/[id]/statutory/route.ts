import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadStatutoryReport } from '@/lib/hr/payroll-reports.server'

export const dynamic = 'force-dynamic'

const PAYROLL_ROLES = ['director', 'admin_officer', 'finance_officer']

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(PAYROLL_ROLES)
    const report = await loadStatutoryReport(id)
    if (!report) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    return NextResponse.json(report)
  })
}
