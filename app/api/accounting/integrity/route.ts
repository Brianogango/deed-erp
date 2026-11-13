import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { runIntegritySuite } from '@/lib/accounting/integrity-suite'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.view')
    const { searchParams } = new URL(request.url)
    const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10)
    const report = await runIntegritySuite(asOf)
    return NextResponse.json(report)
  })
}
