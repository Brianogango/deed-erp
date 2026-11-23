import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { applyMaturedCheques } from '@/lib/cheques/cheque-schedule.server'

export const dynamic = 'force-dynamic'

/** "Apply due cheques now": the same as the regular server run, on request. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.cheques.manage')
    const results = await applyMaturedCheques()
    return NextResponse.json({ ok: true, results })
  })
}
