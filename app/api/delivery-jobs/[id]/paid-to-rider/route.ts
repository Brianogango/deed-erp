import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyCustomerPaidRider, describeOffBooks, retryOffBooks } from '@/lib/delivery/rider-direct-pay.server'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

const ROLES = ['director', 'admin_officer', 'finance_officer']

/**
 * The customer paid the rider the delivery charge directly (office side; the
 * rider records the same thing from their link). It comes off the invoice —
 * a draft's delivery line, or a credit note once posted — and off the
 * rider's pay.
 *   POST { amount, method: 'cash'|'mpesa', reference? } — record it
 *   POST { action: 'settle' } — take it off an invoice that was not ready before
 */
export async function POST(req: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const who = { id: String((actor as any).id), name: String((actor as any).name || (actor as any).username || 'Office') }
    const { id } = await params
    const body = await req.json().catch(() => ({})) as Record<string, any>

    if (body.action === 'settle') {
      const r = await retryOffBooks(id, who)
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json({ job: r.job, offBooks: r.offBooks, message: describeOffBooks(r.offBooks) })
    }

    const amount = Number(body.amount)
    if (!(amount > 0)) return NextResponse.json({ error: 'Enter the amount the customer paid the rider' }, { status: 400 })
    const r = await applyCustomerPaidRider(id, { amount, method: body.method === 'mpesa' ? 'mpesa' : 'cash', reference: String(body.reference ?? '').slice(0, 60) }, { by: who.name, actor: who })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ job: r.job, offBooks: r.offBooks, message: describeOffBooks(r.offBooks) })
  })
}
