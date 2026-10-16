import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { reconcileKilimallDispatchSerials } from '@/lib/inventory/stock-transactions'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'inventory_officer', 'kilimall_officer'])

/**
 * Dispatched Kilimall serials must be sold. GET lists the dispatches whose serial is not;
 * POST { apply: true } marks them sold and takes them out of stock.
 */
async function run(apply: boolean) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await reconcileKilimallDispatchSerials({ apply, userId: session.user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
  return NextResponse.json(result)
}

export async function GET() {
  return run(false)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { apply?: boolean } | null
  return run(body?.apply === true)
}
