import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { commissionCloserOptions } from '@/lib/sales/commission-closer'

/**
 * Compact closer list for quotation/SO salesperson pickers.
 * Sales reps cannot GET /api/users (viewUsers), so this endpoint is the
 * allowed way to choose a colleague without exposing the full user admin list.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('sales.salespeople.view')
    const salespeople = commissionCloserOptions(await listPublicUsers())
    return NextResponse.json({ salespeople })
  })
}
