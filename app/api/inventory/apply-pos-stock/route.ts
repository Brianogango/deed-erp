import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyPosStockMutation, reversePosStockMutation } from '@/lib/inventory/stock-transactions'
import { postPosValuationFromPayload, reversePosValuationFromPayload } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

const POS_ROLES = new Set([
  'director', 'finance_officer', 'admin_officer', 'sales_rep',
  'kilimall_officer', 'inventory_officer',
])

/**
 * Authoritative POS stock deduction (bulk/serials + stock moves) with fail-closed COGS.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!POS_ROLES.has(String(session.user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    orderRef?: string
    lines?: Array<{
      productId: string
      productName: string
      qty: number
      serialId?: string
      serialNumber?: string
      sourceLocation?: string
    }>
  } | null

  if (!body?.orderRef || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'orderRef and lines required' }, { status: 400 })
  }

  const result = await applyPosStockMutation({
    orderRef: body.orderRef,
    lines: body.lines,
    userId: session.user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  let valuation: Awaited<ReturnType<typeof postPosValuationFromPayload>>
  try {
    valuation = await postPosValuationFromPayload({
      orderRef: body.orderRef,
      lines: body.lines.map(l => ({ productId: l.productId, qty: l.qty })),
      userId: session.user.id,
    })
  } catch (err) {
    await reversePosValuationFromPayload({
      orderRef: body.orderRef,
      lines: body.lines.map(l => ({ productId: l.productId, qty: l.qty })),
      userId: session.user.id,
    }).catch(() => {})
    await reversePosStockMutation({ orderRef: body.orderRef, lines: body.lines })
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'POS valuation failed' },
      { status: 422 },
    )
  }

  if (!valuation.ok) {
    await reversePosValuationFromPayload({
      orderRef: body.orderRef,
      lines: body.lines.map(l => ({ productId: l.productId, qty: l.qty })),
      userId: session.user.id,
    }).catch(() => {})
    await reversePosStockMutation({ orderRef: body.orderRef, lines: body.lines })
    return NextResponse.json(
      { ok: false, error: `POS valuation failed: ${valuation.reason || 'unknown'}`, valuation },
      { status: 422 },
    )
  }

  return NextResponse.json({ ok: true, moves: result.moves, valuation })
}
