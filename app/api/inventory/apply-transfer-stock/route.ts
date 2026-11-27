import { userCan } from '@/lib/auth/can'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyTransferStockMutation } from '@/lib/inventory/stock-transactions'
import { markUnitTestsPlaced, testGateError } from '@/lib/inventory/unit-tests.server'

export const dynamic = 'force-dynamic'


export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!userCan(session.user, 'manageInventoryApprovals')) {
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

  const serialIds = body.lines.flatMap(l => (Array.isArray(l.serialIds) ? l.serialIds : [])).filter(Boolean)
  // Placing tested units (out of Inbound) is for Inventory, the Technical
  // lead and Directors.
  if (body.fromLocation === 'pending_testing' && serialIds.length && !userCan(session.user, 'inventory.unit_tests.place')) {
    return NextResponse.json({ error: 'Only Inventory, the Technical lead or a Director can place tested units.' }, { status: 403 })
  }
  // Ready for Sale takes a serialised unit only from Inbound with a passing test.
  const gate = await testGateError(body.fromLocation, body.toLocation, body.lines)
  if (gate) return NextResponse.json({ error: gate }, { status: 422 })

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
  await markUnitTestsPlaced(body.fromLocation, body.toLocation, serialIds, { id: session.user.id, name: session.user.name })
  return NextResponse.json({ ok: true, moves: result.moves })
}
