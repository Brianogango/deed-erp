/**
 * POST — cancel customer credit given in error (e.g. a double credit). The
 * credit goes down; nothing is paid out; the entry that created it is undone.
 * Body: { amount?, reason, date? }  (amount defaults to all that is left)
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { CreditRefundError, cancelCustomerCredit } from '@/lib/accounting/customer-credit-balance.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('accounting.manage')
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { amount?: unknown; reason?: unknown; date?: unknown }
    const date = body.date ? new Date(String(body.date)) : new Date()
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    const lock = await checkFiscalLock(date)
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })
    try {
      const result = await cancelCustomerCredit({
        creditId: id,
        amount: body.amount === undefined || body.amount === '' ? undefined : Number(body.amount),
        reason: String(body.reason || '').slice(0, 300),
        date,
        actor: { id: actor.id, name: actor.name || actor.username || 'Finance' },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof CreditRefundError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }
  })
}
