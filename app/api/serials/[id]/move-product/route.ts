/**
 * POST { productId, reason, specs? } — move a machine filed under the wrong
 * product (model or specs) to the right one, with its count and cost.
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { withAppStateKeyLock, notifyStoreKeysChanged } from '@/lib/server-store'
import { moveSerialToProduct } from '@/lib/inventory/unit-product-move.server'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editSerialNumber')
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { productId?: unknown; reason?: unknown; specs?: unknown }
    const result = await withAppStateKeyLock('deed_serials', () => moveSerialToProduct({
      userId: user.id,
      serialId: id,
      productId: String(body.productId || ''),
      reason: String(body.reason || ''),
      specs: typeof body.specs === 'string' ? body.specs : undefined,
    }))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    await writeFinancialAudit({
      userId: user.id, action: 'serial_move_product', entityType: 'serial', entityId: result.serial.id,
      newValues: { serial: result.serial.serial, from: result.fromProductName, to: result.serial.productName, cost: result.cost, reason: String(body.reason || '') },
    }).catch(() => {})
    await notifyStoreKeysChanged(['deed_products', 'deed_serials', 'deed_stockMoves']).catch(() => {})
    return NextResponse.json(result)
  })
}
