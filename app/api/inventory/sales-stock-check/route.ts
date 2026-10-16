import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { findSalesStockGaps } from '@/lib/inventory/sales-stock-gaps'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'finance_officer', 'admin_officer', 'inventory_officer', 'kilimall_officer'])

/** Read-only: sales (Kilimall, till, delivery notes) whose stock was not taken out. Nothing is changed. */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState(['deed_serials', 'deed_products', 'deed_posOrders', 'deed_deliveries', 'deed_kilimallDispatches', 'deed_stockMoves'])
  const arr = (v: unknown) => (Array.isArray(v) ? v as Array<Record<string, any>> : [])
  const report = findSalesStockGaps({
    serials: arr(state.deed_serials),
    products: arr(state.deed_products),
    posOrders: arr(state.deed_posOrders),
    deliveries: arr(state.deed_deliveries),
    kilimallDispatches: arr(state.deed_kilimallDispatches),
    stockMoves: arr(state.deed_stockMoves),
  })
  const byProblem: Record<string, number> = {}
  for (const g of report.gaps) byProblem[`${g.channel}:${g.problem}`] = (byProblem[`${g.channel}:${g.problem}`] ?? 0) + 1
  return NextResponse.json({ ...report, summary: byProblem }, { headers: { 'Cache-Control': 'private, no-store' } })
}
