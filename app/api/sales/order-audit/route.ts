import { userCan } from '@/lib/auth/can'
import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { auditSalesOrders } from '@/lib/sales/order-audit'

export const dynamic = 'force-dynamic'


/** Read-only: confirmed orders invoiced before any delivery was done, and possible duplicate orders. */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!userCan(session.user, 'sales.orders.audit')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const state = await loadAppState(['deed_saleOrders', 'deed_invoices', 'deed_deliveries', 'deed_serials', 'deed_products'])
  const arr = (v: unknown) => (Array.isArray(v) ? v as Array<Record<string, any>> : [])
  return NextResponse.json(
    auditSalesOrders({
      orders: arr(state.deed_saleOrders), invoices: arr(state.deed_invoices), deliveries: arr(state.deed_deliveries),
      serials: arr(state.deed_serials), products: arr(state.deed_products),
    }),
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
