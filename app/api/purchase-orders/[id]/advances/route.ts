import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { loadAdvances, recordAdvance, refundAdvance } from '@/lib/purchase/vendor-advance.server'

export const dynamic = 'force-dynamic'

/**
 * Money paid to the supplier before the goods arrive, on this order
 * (lib/purchase/vendor-advance-core.ts). Same permission as paying a bill.
 *  GET            the order's advances and what is still open
 *  POST pay       { amount, method, bankAccountId?, reference?, date? }
 *  POST refund    { advanceId, amount?, method, bankAccountId?, reference?, date? }
 */
export async function GET(_request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requirePermission('invoices.manage')
    const { id } = await resolveRouteParams(params)
    const advances = await loadAdvances(prisma, [id])
    return NextResponse.json({ advances }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('invoices.manage')
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action || 'pay')
    if (action === 'pay') {
      const result = await recordAdvance({ poId: id, amount: body.amount, method: body.method, bankAccountId: body.bankAccountId, reference: body.reference, date: body.date, actorId: actor.id })
      return NextResponse.json({ ok: true, ...result })
    }
    if (action === 'refund') {
      const result = await refundAdvance({ advanceId: String(body.advanceId || ''), amount: body.amount, method: body.method, bankAccountId: body.bankAccountId, reference: body.reference, date: body.date, actorId: actor.id })
      return NextResponse.json({ ok: true, ...result })
    }
    return NextResponse.json({ error: 'Unknown action — use pay or refund' }, { status: 400 })
  })
}
