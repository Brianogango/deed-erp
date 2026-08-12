import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildPartnerLedgerFromPrisma } from '@/lib/accounting/partner-ledger.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const report = await buildPartnerLedgerFromPrisma({
      partnerId: searchParams.get('partnerId'),
      partnerName: searchParams.get('partnerName') || searchParams.get('q'),
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      kind: (searchParams.get('kind') as 'ar' | 'ap' | 'all') || 'all',
    })
    return NextResponse.json({ ok: true, ...report, source: 'prisma' })
  })
}
