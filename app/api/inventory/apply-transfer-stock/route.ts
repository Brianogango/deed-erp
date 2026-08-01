import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { applyTransferStockMutation } from '@/lib/inventory/stock-transactions'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPermission(session.user, 'manageInventory')) {
    // Fall back to common inventory roles when permission helper lacks the key
    const role = String(session.user.role)
    if (!['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
