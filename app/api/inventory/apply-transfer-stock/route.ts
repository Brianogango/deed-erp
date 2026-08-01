import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyTransferStockMutation } from '@/lib/inventory/stock-transactions'

export const dynamic = 'force-dynamic'

const TRANSFER_ROLES = new Set([
  'director', 'admin_officer', 'inventory_officer', 'technical_lead',
])

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!TRANSFER_ROLES.has(String(session.user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    transferRef?: string
    fromLocation?: string
    toLocation?: string
    lines?: Array<{ productId: string; productName: string; qty: number; serialIds?: string[] }>
  } | null

  if (!body?.transferRef || !body.fromLocation || !body.toLocation || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: 'transferRef, fromLocation, toLocation, lines required' }, { status: 400 })
  }

  const result = await applyTransferStockMutation({
    transferRef: body.transferRef,
    fromLocation: body.fromLocation,
    toLocation: body.toLocation,
    lines: body.lines,
    userId: session.user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  return NextResponse.json({ ok: true, moves: result.moves })
}
