import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyVendorReturnStockMutation } from '@/lib/inventory/stock-transactions'
import { postVendorReturnValuation } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'admin_officer', 'inventory_officer'])

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    returnRef?: string
    lines?: Array<{
      productId: string
      productName: string
      qty: number
      serialIds?: string[]
      requiresSerial?: boolean
    }>
  } | null

  if (!body?.returnRef || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'returnRef and lines required' }, { status: 400 })
  }

  const result = await applyVendorReturnStockMutation({
    returnRef: body.returnRef,
    lines: body.lines,
    userId: session.user.id,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const valuation = await postVendorReturnValuation({
    returnRef: body.returnRef,
    lines: body.lines,
    userId: session.user.id,
  }).catch(err => ({ ok: false as const, reason: err instanceof Error ? err.message : 'valuation_failed', results: [], warnings: [] }))

  return NextResponse.json({ ok: true, moves: result.moves, valuation })
}
