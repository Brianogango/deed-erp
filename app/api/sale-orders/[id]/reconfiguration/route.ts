import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import {
  analyzeSaleOrderReconfig,
  syncReconfigurationFromSaleOrder,
} from '@/lib/reconfiguration/sales-bridge'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'technical_lead', 'inventory_officer']

/** GET — analyze whether this SO needs / has a linked reconfiguration. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const analysis = await analyzeSaleOrderReconfig(resolvedParams.id)
    if (!analysis) {
      return NextResponse.json({
        saleOrderId: resolvedParams.id,
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
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const result = await syncReconfigurationFromSaleOrder({
      saleOrderId: resolvedParams.id,
      userId: actor.id,
    })
    return NextResponse.json(result)
  })
}
