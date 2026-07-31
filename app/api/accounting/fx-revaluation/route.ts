import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { postFxGainLoss } from '@/lib/accounting/fx-journals'

const WRITE_ROLES = ['director', 'finance_officer']

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await requireRole(WRITE_ROLES)
    const body = await request.json()

    const amountBase = Number(body.amountBase)
    const amountForeign = Number(body.amountForeign)
    const rate = Number(body.rate)
    const ref = String(body.ref || '').trim()
    const balanceAccountLabel = String(body.balanceAccountLabel || body.balanceAccount || '').trim()

    if (!ref) return NextResponse.json({ error: 'ref is required' }, { status: 400 })
    if (!balanceAccountLabel) {
      return NextResponse.json({ error: 'balanceAccountLabel is required' }, { status: 400 })
    }
    if (!Number.isFinite(amountBase) || !Number.isFinite(amountForeign) || !Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ error: 'amountBase, amountForeign, and positive rate are required' }, { status: 400 })
    }

    const result = await postFxGainLoss({
      amountBase,
      amountForeign,
      rate,
      ref,
      date: body.date,
      userId: session.id,
      balanceAccountLabel,
      accountGain: body.accountGain,
      accountLoss: body.accountLoss,
      description: body.description,
    })

    return NextResponse.json(result, { status: result.skipped ? 200 : 201 })
  })
}
