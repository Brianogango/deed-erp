/**
 * POST — pay a customer's credit back as money (cash, M-Pesa, bank, cheque).
 * Body: { amount, method, bankAccountId?, reference?, date? }
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { CreditRefundError, refundCustomerCredit } from '@/lib/accounting/customer-credit-balance.server'
import { BankAccountRefError } from '@/lib/accounting/bank-cash-account.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('customer_credits.refund')
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { amount?: unknown; method?: unknown; bankAccountId?: unknown; reference?: unknown; date?: unknown }
    const date = body.date ? new Date(String(body.date)) : new Date()
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    const lock = await checkFiscalLock(date)
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })
    try {
      const result = await refundCustomerCredit({
        creditId: id,
        amount: Number(body.amount),
        method: String(body.method || ''),
        bankAccountId: typeof body.bankAccountId === 'string' && body.bankAccountId ? body.bankAccountId : null,
        reference: typeof body.reference === 'string' ? body.reference.trim().slice(0, 120) : null,
        date,
        actor: { id: actor.id, name: actor.name || actor.username || 'Finance' },
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof CreditRefundError || err instanceof BankAccountRefError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  })
}
