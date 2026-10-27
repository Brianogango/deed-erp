import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { applyCustomerReturnStockMutation } from '@/lib/inventory/stock-transactions'
import { postCustomerReturnValuation } from '@/lib/inventory/valuation-hooks'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { kilimallReturnPlan, type KilimallReturnInput } from '@/lib/kilimall/kilimall-return'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer', 'kilimall_officer', 'kilimall', 'inventory_officer', 'finance_officer']

type Params = { params: Promise<{ id: string }> }

/**
 * A Kilimall order came back. The shipped device goes back to the warehouse
 * as "returned" (awaiting inspection; Inventory releases it to stock), stock
 * goes up and the dispatch cost is reversed — the same stock-in as a
 * customer return. Refund: the order ends as returned (its settlement line
 * reads Returned). Exchange: the order goes back to Pending Dispatch so a
 * replacement ships through the normal Dispatch step.
 *
 * Under the orders lock and refused when the order is not out with the
 * customer, so the same return cannot add the device back twice.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as Partial<KilimallReturnInput>

    return withAppStateKeyLock('deed_kilimallOrders', async () => {
      const state = await loadAppStateForWrite(['deed_kilimallOrders'])
      const orders = Array.isArray(state.deed_kilimallOrders) ? [...state.deed_kilimallOrders as Array<Record<string, any>>] : []
      const idx = orders.findIndex(o => o?.id === id)
      if (idx < 0) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

      const plan = kilimallReturnPlan(orders[idx], body, { by: user.name || user.username, at: new Date().toISOString() })
      if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 422 })

      // The device must still be out with the customer: one that is already
      // back in stock (put back by hand) would be counted twice.
      if (plan.serialId) {
        const { deed_serials } = await loadAppStateForWrite(['deed_serials'])
        const serial = (Array.isArray(deed_serials) ? deed_serials as Array<Record<string, any>> : []).find(s => s?.id === plan.serialId)
        if (serial && serial.status !== 'sold') {
          return NextResponse.json({ error: `Serial ${serial.serial ?? plan.serialId} is already back in stock (${serial.status}). Nothing to take back.` }, { status: 422 })
        }
      }

      const stock = await applyCustomerReturnStockMutation({
        returnRef: plan.returnRef,
        lines: [{ productId: plan.productId, productName: plan.productName, qty: 1, serialIds: plan.serialId ? [plan.serialId] : undefined }],
        userId: user.id,
      })
      if (!stock.ok) return NextResponse.json({ error: stock.error }, { status: 422 })

      const valuation = await postCustomerReturnValuation({
        returnRef: plan.returnRef,
        lines: [{ productId: plan.productId, qty: 1 }],
        userId: user.id,
      }).catch(err => ({ ok: false as const, reason: err instanceof Error ? err.message : 'valuation_failed' }))

      orders[idx] = plan.order
      await saveStoreKeys({ deed_kilimallOrders: JSON.stringify(orders) })
      await writeFinancialAudit({
        userId: user.id,
        action: 'kilimall_return',
        entityType: 'kilimall_order',
        entityId: id,
        newValues: { ref: plan.order.ref, outcome: plan.entry.outcome, serialNumber: plan.entry.serialNumber, condition: plan.entry.condition },
      }).catch(() => {})

      return NextResponse.json({ ok: true, order: plan.order, valuation })
    })
  })
}
