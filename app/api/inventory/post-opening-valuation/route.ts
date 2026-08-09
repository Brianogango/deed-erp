import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { postOpeningStockValuation } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(session.user.role)
  if (!['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    items?: Array<{ productId: string; qty: number; unitCost?: number }>
    reference?: string
  } | null

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'items required' }, { status: 400 })
  }

  const result = await postOpeningStockValuation({
    items: body.items,
    reference: body.reference || 'OPENING',
    userId: session.user.id,
  })
  return NextResponse.json(result)
}
