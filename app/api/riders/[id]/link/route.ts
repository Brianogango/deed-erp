import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { setRiderToken } from '@/lib/delivery/rider-portal.server'
import { newRiderToken, riderPin } from '@/lib/delivery/rider-portal'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

const ROLES = ['director', 'admin_officer', 'inventory_officer', 'finance_officer']

/** POST { reset?: boolean } — the rider's personal link (a new one when reset). */
export async function POST(req: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { reset?: boolean; existing?: string }
    const { loadAppState } = await import('@/lib/server-store')
    const state = await loadAppState(['deed_riders'])
    const current = (Array.isArray(state.deed_riders) ? state.deed_riders as any[] : []).find(r => r.id === id)
    if (!current) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })
    if (!riderPin(current)) {
      return NextResponse.json({ error: 'Add the rider\'s ID number or phone first: the last 4 digits are their PIN.' }, { status: 422 })
    }
    let rider = current
    if (body.reset || !current.portalToken) {
      rider = await setRiderToken(id, newRiderToken())
      if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })
      await writeFinancialAudit({
        userId: actor.id,
        action: body.reset ? 'reset_rider_link' : 'create_rider_link',
        entityType: 'rider',
        entityId: id,
        newValues: { riderName: rider.name },
      }).catch(() => {})
    }
    const base = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/+$/, '')
    return NextResponse.json({ url: `${base}/portal/rider/${rider.portalToken}`, pinHint: rider.idNumber ? 'last 4 digits of their ID number' : 'last 4 digits of their phone number' })
  })
}
