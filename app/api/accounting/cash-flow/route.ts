import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { buildCashFlowStatement } from '@/lib/accounting/cash-flow.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.view')
    const { searchParams } = new URL(request.url)
    const dateTo = searchParams.get('dateTo') || new Date().toISOString().slice(0, 10)
    const dateFrom = searchParams.get('dateFrom') || `${dateTo.slice(0, 4)}-01-01`
    const report = await buildCashFlowStatement({ dateFrom, dateTo })
    return NextResponse.json(report)
  })
}
