/**
 * POST — move a payment to the bank or cash account it really went through
 * (lib/accounting/payment-bank-change.server.ts). Body: { bankAccountId, reason }.
 * Refused once the payment is matched in bank reconciliation.
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { changePaymentBank } from '@/lib/accounting/payment-bank-change.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string; paymentId: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('invoices.payments.reverse')
    const { id, paymentId } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { bankAccountId?: unknown; reason?: unknown }
    const change = await changePaymentBank({
      invoiceId: id,
      paymentId,
      bankAccountId: String(body.bankAccountId ?? ''),
      reason: String(body.reason ?? '').slice(0, 500),
      actor: { id: actor.id, name: actor.name || actor.username },
    })
    return NextResponse.json({ change })
  })
}
