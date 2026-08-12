import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildCashbookEntriesFromPrisma } from '@/lib/accounting/cashbook.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const report = await buildCashbookEntriesFromPrisma({
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      bankAccountCode: searchParams.get('accountCode'),
      take: Number(searchParams.get('take') || 500),
    })
    return NextResponse.json({ ok: true, ...report, source: 'prisma' })
  })
}
