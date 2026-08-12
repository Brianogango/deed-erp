import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildAgeingFromPrisma } from '@/lib/accounting/ageing.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const kind = (searchParams.get('kind') || 'ar') as 'ar' | 'ap'
    if (kind !== 'ar' && kind !== 'ap') {
      return NextResponse.json({ error: 'kind must be ar or ap' }, { status: 400 })
    }
    const report = await buildAgeingFromPrisma({
      kind,
      asOf: searchParams.get('asOf'),
    })
    return NextResponse.json({ ok: true, kind, ...report, source: 'prisma' })
  })
}
