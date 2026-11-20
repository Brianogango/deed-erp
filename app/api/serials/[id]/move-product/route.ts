/**
 * POST { productId, reason, specs? } — move a machine filed under the wrong
 * product (model or specs) to the right one, with its count and cost.
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { userCan } from '@/lib/auth/can'
import { withAppStateKeyLock, notifyStoreKeysChanged } from '@/lib/server-store'
import { moveSerialToProduct } from '@/lib/inventory/unit-product-move.server'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user
    // Stock staff move any machine in stock. Whoever identifies refurbishment
    // machines (technicians included) may correct the model of one on the
    // bench — that is where a vaguely named machine is first looked at.
    const canMoveStock = userCan(user, 'editSerialNumber')
    if (!canMoveStock && !userCan(user, 'refurbishment.identify')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { productId?: unknown; reason?: unknown; specs?: unknown }
    const result = await withAppStateKeyLock('deed_serials', () => moveSerialToProduct({
      userId: user.id,
      serialId: id,
      productId: String(body.productId || ''),
      reason: String(body.reason || ''),
      specs: typeof body.specs === 'string' ? body.specs : undefined,
      benchOnly: !canMoveStock,
    }))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    await writeFinancialAudit({
      userId: user.id, action: 'serial_move_product', entityType: 'serial', entityId: result.serial.id,
      newValues: { serial: result.serial.serial, from: result.fromProductName, to: result.serial.productName, cost: result.cost, reason: String(body.reason || '') },
    }).catch(() => {})
    await notifyStoreKeysChanged(['deed_products', 'deed_serials', 'deed_stockMoves', 'deed_refurbishmentJobs']).catch(() => {})
    return NextResponse.json(result)
  })
}
