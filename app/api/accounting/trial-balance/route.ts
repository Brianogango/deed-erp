import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildTrialBalance } from '@/lib/accounting/gl-reports'
import { readOptimisedReport } from '@/lib/infra/report-snapshots'

export const dynamic = 'force-dynamic'

/**
 * Cumulative as-of trial balance from posted journal_entry_lines.
 * Includes original journals after reversal (original + reversal both remain).
 * Unmapped accounts fail closed — they are never classified as asset.
 * Query: asOf / dateTo, source=auto|live|snapshot
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') || searchParams.get('dateTo') || new Date().toISOString().slice(0, 10)
    const report = await readOptimisedReport(
      'trial_balance',
      { asOf },
      () => buildTrialBalance({ asOf }),
      { source: searchParams.get('source') },
    )
    return NextResponse.json(report, {
      headers: { 'x-deed-report-source': report._reporting.source },
    })
  })
}
