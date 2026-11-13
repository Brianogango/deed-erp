import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { buildHistoricalAgeing } from '@/lib/accounting/ageing.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.view')
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') === 'ap' ? 'ap' : 'ar'
    const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10)
    const report = await buildHistoricalAgeing({ kind, asOf })
    return NextResponse.json(report)
  })
}
