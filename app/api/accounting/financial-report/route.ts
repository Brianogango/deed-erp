import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasModuleAccess } from '@/lib/auth/access'
import { buildFinancialReport } from '@/lib/accounting/financial-report'

export const dynamic = 'force-dynamic'

const REPORT_ROLES = ['director', 'finance_officer', 'admin_officer']

/**
 * GET /api/accounting/financial-report?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * The comprehensive source-of-truth financial report for a period.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!REPORT_ROLES.includes(session.user.role) && !hasModuleAccess(session.user, 'accounting')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const today = new Date().toISOString().slice(0, 10)
  const dateTo = searchParams.get('dateTo') || today
  const dateFrom = searchParams.get('dateFrom') || `${dateTo.slice(0, 4)}-01-01`

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: 'dateFrom and dateTo must be YYYY-MM-DD' }, { status: 400 })
  }

  const report = await buildFinancialReport({ dateFrom, dateTo })
  return NextResponse.json(report)
}
