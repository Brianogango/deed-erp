import { NextRequest } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { leanSaleOrders } from '@/lib/dashboard/lean-sale-orders'
import { loadViewerState } from '@/lib/store-viewer-state.server'
import { compressedJson } from '@/lib/http/compressed-json'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dashboard/sale-orders
 *
 * The sale orders the user may see, cut to the fields the dashboard and its
 * sales widgets read (lib/dashboard/lean-sale-orders.ts).
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const state = await loadViewerState(session.user as never, ['deed_saleOrders'])
    return compressedJson(request, JSON.stringify({ saleOrders: leanSaleOrders(state.deed_saleOrders) }), { headers: { 'Cache-Control': 'no-store' } })
  })
}
