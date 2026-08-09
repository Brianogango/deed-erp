import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyAdjustmentStockMutation } from '@/lib/inventory/stock-transactions'
import { postAdjustmentValuation } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(session.user.role)
  if (!['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    adjustmentRef?: string
    productId?: string
    productName?: string
    type?: 'add' | 'subtract'
    qty?: number
    reason?: string
    location?: string
    unitCost?: number
  } | null

  if (!body?.adjustmentRef || !body.productId || !body.type || !body.qty) {
    return NextResponse.json({ error: 'adjustmentRef, productId, type, qty required' }, { status: 400 })
  }

  const result = await applyAdjustmentStockMutation({
    adjustmentRef: body.adjustmentRef,
    productId: body.productId,
    productName: body.productName || 'Product',
    type: body.type,
    qty: Number(body.qty),
    reason: body.reason || 'Stock adjustment',
    location: body.location || 'warehouse',
    userId: session.user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const valuation = await postAdjustmentValuation({
    adjustmentRef: body.adjustmentRef,
    productId: body.productId,
    type: body.type,
    qty: Number(body.qty),
    unitCost: body.unitCost,
    userId: session.user.id,
  }).catch(err => ({ ok: false as const, reason: err instanceof Error ? err.message : 'valuation_failed' }))

  return NextResponse.json({ ok: true, moves: result.moves, valuation })
}
