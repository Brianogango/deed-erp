import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { loadAnnualReport } from '@/lib/hr/payroll-reports.server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('managePayroll')
    const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getFullYear()
    if (year < 2000 || year > 2100) return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    return NextResponse.json({ year, employees: await loadAnnualReport(year) })
  })
}
