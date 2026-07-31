import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildGeneralLedger } from '@/lib/accounting/gl-reports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const accountCode = searchParams.get('accountCode') ?? undefined
    const accountId = searchParams.get('accountId') ?? undefined
    const dateFrom = searchParams.get('dateFrom') ?? undefined
    const dateTo = searchParams.get('dateTo') ?? undefined

    if (!accountCode && !accountId) {
      return NextResponse.json({ error: 'accountCode or accountId is required' }, { status: 400 })
    }

    const report = await buildGeneralLedger({ accountCode, accountId, dateFrom, dateTo })
    return NextResponse.json(report)
  })
}
