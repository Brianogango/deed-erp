import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { RepairOrder } from '@/lib/store'

const REPAIR_STORE_KEY = 'deed_repairs_v2'
const VERIFY_ROLES = ['director', 'admin_officer', 'technical_lead']

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VERIFY_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { notes?: string; accessories?: RepairOrder['accessories'] }
  const state = await loadAppState()
  const repairs = Array.isArray(state[REPAIR_STORE_KEY]) ? state[REPAIR_STORE_KEY] as RepairOrder[] : []
  const idx = repairs.findIndex(r => r.id === params.id || r.ref === decodeURIComponent(params.id))
  if (idx === -1) return NextResponse.json({ error: 'Repair not found' }, { status: 404 })

  const repair = repairs[idx]
  if (repair.status !== 'pending_verification') {
    return NextResponse.json({ error: `Repair cannot be verified from status ${repair.status}` }, { status: 409 })
  }

  const today = new Date().toISOString().slice(0, 10)
  repairs[idx] = {
    ...repair,
    status: 'received',
    verificationDate: today,
    verifiedBy: session.user.name ?? session.user.email ?? session.user.id,
    verificationNotes: String(body.notes ?? '').trim() || undefined,
    accessories: Array.isArray(body.accessories) ? body.accessories : repair.accessories,
  }

  await saveStoreKeys({ [REPAIR_STORE_KEY]: JSON.stringify(repairs) })
  return NextResponse.json({ repair: repairs[idx] })
}
