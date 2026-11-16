import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { dashboardSectionsForUser } from '@/lib/dashboard-priority'
import { customerRevenueFromInvoices } from '@/lib/dashboard/customer-revenue'
import { monthsInWindow } from '@/lib/dashboard/sales-analytics'
import { loadViewerState } from '@/lib/store-viewer-state.server'

export const dynamic = 'force-dynamic'

const ISO_MONTH = /^\d{4}-\d{2}$/
const MAX_MONTHS = 24

/**
 * GET /api/dashboard/customer-revenue?end=YYYY-MM&months=3&limit=5
 *
 * Customers ranked by posted invoice value over a window of months ending at
 * `end`. Worked out here because the dashboard does not download the invoice
 * list, and because invoices — not sale orders — are where every kind of
 * revenue lands: sales, repairs, the till, and invoices raised in Finance.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user
    // The same gate as the rest of the sales analytics on the dashboard.
    if (!dashboardSectionsForUser(user as never).sales) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const params = new URL(request.url).searchParams
    const end = params.get('end') ?? ''
    if (!ISO_MONTH.test(end)) {
      return NextResponse.json({ error: 'end must be YYYY-MM' }, { status: 400 })
    }
    const months = Math.min(MAX_MONTHS, Math.max(1, Number(params.get('months')) || 1))
    const limit = Math.min(20, Math.max(1, Number(params.get('limit')) || 5))

    const state = await loadViewerState(user as never, ['deed_invoices'])
    const result = customerRevenueFromInvoices(state.deed_invoices, {
      months: new Set(monthsInWindow(end, months)),
      limit,
    })

    return NextResponse.json({ end, months, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
