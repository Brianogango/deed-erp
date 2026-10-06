/**
 * POST — reverse a payment registered by mistake (lib/accounting/payment-reversal.ts).
 * Body: { reason }. Finance officers and directors only. The invoice owes the
 * money again; register the right amount as a new payment.
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { reverseInvoicePayment } from '@/lib/accounting/payment-reversal.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string; paymentId: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const { id, paymentId } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { reason?: unknown }
    const reversal = await reverseInvoicePayment({
      invoiceId: id,
      paymentId,
      reason: String(body.reason ?? '').slice(0, 500),
      actor: { id: actor.id, name: actor.name || actor.username },
    })
    return NextResponse.json({ reversal })
  })
}
