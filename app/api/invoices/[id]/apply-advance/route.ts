import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { applyAdvancesToBill } from '@/lib/purchase/vendor-advance.server'

export const dynamic = 'force-dynamic'

/**
 * Use the money paid in advance on this bill's purchase order to settle the
 * bill (Dr Payables / Cr Advances to Suppliers). Called after a bill from a
 * prepaid order is confirmed; safe to call again (only what is open is used).
 */
export async function POST(_request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('invoices.manage')
    const { id } = await resolveRouteParams(params)
    const result = await applyAdvancesToBill(id, actor.id)
    return NextResponse.json({ ok: true, ...result })
  })
}
