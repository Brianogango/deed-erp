import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyPosStockMutation } from '@/lib/inventory/stock-transactions'

export const dynamic = 'force-dynamic'

const POS_ROLES = new Set([
  'director', 'finance_officer', 'admin_officer', 'sales_rep',
  'kilimall_officer', 'inventory_officer',
])

/**
 * Authoritative POS stock deduction (bulk/serials + stock moves).
 * Call before (or instead of) client-side qty mutation.
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
  return NextResponse.json({ ok: true, moves: result.moves })
}
