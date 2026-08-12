import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildManagementProfitAndLoss, buildProfitAndLoss } from '@/lib/accounting/gl-reports'

export const dynamic = 'force-dynamic'

/**
 * GET /api/accounting/profit-loss
 * Query: dateFrom, dateTo (YYYY-MM-DD), view=management|flat (default management)
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo = searchParams.get('dateTo') ?? undefined
    const view = (searchParams.get('view') || 'management').toLowerCase()
    const report = view === 'flat'
      ? await buildProfitAndLoss({ dateFrom, dateTo })
      : await buildManagementProfitAndLoss({ dateFrom, dateTo })
    return NextResponse.json(report)
  })
}
