import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildManagementProfitAndLoss, buildProfitAndLoss } from '@/lib/accounting/gl-reports'
import { readOptimisedReport } from '@/lib/infra/report-snapshots'

export const dynamic = 'force-dynamic'

/**
 * GET /api/accounting/profit-loss
 * Query: dateFrom, dateTo (YYYY-MM-DD), view=management|flat (default management),
 *        source=auto|live|snapshot
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo = searchParams.get('dateTo') ?? undefined
    const view = (searchParams.get('view') || 'management').toLowerCase()
    const source = searchParams.get('source')
    const kind = view === 'flat' ? 'profit_loss' : 'profit_loss_management'
    const report = await readOptimisedReport(
      kind,
      { dateFrom, dateTo, view: view === 'flat' ? 'flat' : 'management' },
      () => view === 'flat'
        ? buildProfitAndLoss({ dateFrom, dateTo })
        : buildManagementProfitAndLoss({ dateFrom, dateTo }),
      { source },
    )
    return NextResponse.json(report, {
      headers: { 'x-deed-report-source': report._reporting.source },
    })
  })
}
