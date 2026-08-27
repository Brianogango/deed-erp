import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildHistoricalAgeing } from '@/lib/accounting/ageing.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') === 'ap' ? 'ap' : 'ar'
    const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10)
    const report = await buildHistoricalAgeing({ kind, asOf })
    return NextResponse.json(report)
  })
}
