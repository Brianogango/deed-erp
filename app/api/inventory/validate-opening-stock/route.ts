import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { loadAppState } from '@/lib/server-store'
import { validateOpeningStockInput } from '@/lib/inventory-validation'

const ALLOWED_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

export const dynamic = 'force-dynamic'

type OpeningItemPayload = {
  productId: string
  productName?: string
  qty: number
  requiresSerial: boolean
  serials?: string[]
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = normalizePermissionRole(session.user.role)
  const allowed = ALLOWED_ROLES.map(item => normalizePermissionRole(item)).filter(Boolean)
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { items?: OpeningItemPayload[] } | null
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'Expected body { items: [...] }' }, { status: 400 })
  }

  const state = await loadAppState(['deed_serials'])
  const existingSerials = Array.isArray(state.deed_serials) ? state.deed_serials as Array<{ serial?: string; barcode?: string }> : []
  const result = validateOpeningStockInput(body.items, existingSerials)

  if (!result.ok) return NextResponse.json(result, { status: 422 })
  return NextResponse.json(result)
}
