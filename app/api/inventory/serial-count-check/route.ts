import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { compareSerialCount } from '@/lib/inventory/serial-count-compare'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'finance_officer', 'admin_officer', 'inventory_officer'])

/** Read-only: compare a physical count (list of serials) with the serial register. Changes nothing. */
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null) as { serials?: unknown } | null
  const counted = Array.isArray(body?.serials) ? body!.serials.map(v => String(v)).slice(0, 20000) : []
  if (counted.length === 0) return NextResponse.json({ error: 'Send the counted serial numbers' }, { status: 422 })

  const state = await loadAppState(['deed_serials', 'deed_products'])
  const arr = (v: unknown) => (Array.isArray(v) ? v as Array<Record<string, any>> : [])
  return NextResponse.json(
    compareSerialCount({ counted, serials: arr(state.deed_serials), products: arr(state.deed_products) }),
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
