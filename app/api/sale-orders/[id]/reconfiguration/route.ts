import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import {
  analyzeSaleOrderReconfig,
  syncReconfigurationFromSaleOrder,
} from '@/lib/reconfiguration/sales-bridge'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'technical_lead', 'inventory_officer']

/** GET — analyze whether this SO needs / has a linked reconfiguration. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const analysis = await analyzeSaleOrderReconfig(params.id)
    if (!analysis) {
      return NextResponse.json({
        saleOrderId: params.id,
        effects: [],
        workOrder: null,
        deliveryBlocked: false,
        message: 'No reconfiguration-relevant lines.',
      })
    }
    return NextResponse.json(analysis)
  })
}

/** POST — create/update linked draft RCF from current SO lines. */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const result = await syncReconfigurationFromSaleOrder({
      saleOrderId: params.id,
      userId: actor.id,
    })
    return NextResponse.json(result)
  })
}
