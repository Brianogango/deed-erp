import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { buildBalanceSheet } from '@/lib/accounting/gl-reports'
import { readOptimisedReport } from '@/lib/infra/report-snapshots'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.view')
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)
    const report = await readOptimisedReport(
      'balance_sheet',
      { asOf },
      () => buildBalanceSheet({ asOf }),
      { source: searchParams.get('source') },
    )
    return NextResponse.json(report, {
      headers: { 'x-deed-report-source': report._reporting.source },
    })
  })
}
