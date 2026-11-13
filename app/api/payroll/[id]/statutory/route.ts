import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { loadStatutoryReport } from '@/lib/hr/payroll-reports.server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requirePermission('managePayroll')
    const report = await loadStatutoryReport(id)
    if (!report) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    return NextResponse.json(report)
  })
}
