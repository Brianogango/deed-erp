import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAnnualReport } from '@/lib/hr/payroll-reports.server'

export const dynamic = 'force-dynamic'

const PAYROLL_ROLES = ['director', 'admin_officer', 'finance_officer']

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(PAYROLL_ROLES)
    const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getFullYear()
    if (year < 2000 || year > 2100) return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    return NextResponse.json({ year, employees: await loadAnnualReport(year) })
  })
}
