import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { postPeriodDepreciation } from '@/lib/accounting/fixed-asset-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const period = String(body.period || '').trim()
    if (!period) return NextResponse.json({ error: 'period (YYYY-MM) is required' }, { status: 400 })
    const result = await postPeriodDepreciation({ period, createdById: actor.id })
    return NextResponse.json(result)
  })
}
