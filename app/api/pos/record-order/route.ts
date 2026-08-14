import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { mergePosOrdersStoreWrite } from '@/lib/pos-orders-merge'

export const dynamic = 'force-dynamic'

const POS_ROLES = ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'kilimall_officer']

/**
 * POST /api/pos/record-order
 * Append one till ticket into deed_posOrders under an advisory lock.
 * Union-merge so a concurrent stale sync cannot drop the new sale.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(POS_ROLES)
    const body = await request.json().catch(() => null)
    const order = body && typeof body === 'object' ? (body as { order?: unknown }).order : null
    if (!order || typeof order !== 'object' || Array.isArray(order)) {
      return NextResponse.json({ error: 'order is required' }, { status: 400 })
    }
    const id = String((order as { id?: unknown }).id ?? '').trim()
    const ref = String((order as { ref?: unknown }).ref ?? '').trim()
    if (!id || !ref) {
      return NextResponse.json({ error: 'order.id and order.ref are required' }, { status: 400 })
    }

    const merged = await withAppStateKeyLock('deed_posOrders', async () => {
      const state = await loadAppState(['deed_posOrders'])
      const next = mergePosOrdersStoreWrite(state.deed_posOrders, [order])
      await saveStoreKeys({ deed_posOrders: JSON.stringify(next) })
      return next
    })

    return NextResponse.json({ ok: true, count: merged.length, id, ref })
  })
}
