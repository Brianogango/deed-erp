import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildBalanceSheet } from '@/lib/accounting/gl-reports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)
    const report = await buildBalanceSheet({ asOf })
    return NextResponse.json(report)
  })
}
