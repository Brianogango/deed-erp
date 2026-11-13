import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { runNumberCheck } from '@/lib/accounting/number-check.server'

export const dynamic = 'force-dynamic'

/** GET — refunds, POS session closes and returns the old repeated numbers may have kept out of the books. Read only. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.view')
    return NextResponse.json(await runNumberCheck())
  })
}
