import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { releaseStaleSerialHolds } from '@/lib/inventory/stock-transactions'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'inventory_officer', 'admin_officer', 'finance_officer'])

async function run(apply: boolean) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await releaseStaleSerialHolds({ apply })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
  return NextResponse.json(result)
}

/** GET lists serials held for orders that are cancelled, back to quotation or gone; POST { apply: true } frees them. */
export async function GET() { return run(false) }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { apply?: boolean } | null
  return run(body?.apply === true)
}
