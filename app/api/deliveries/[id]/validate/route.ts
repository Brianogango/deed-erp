import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const DELIVERY_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole(DELIVERY_ROLES)
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState()
  const deliveries: any[] = Array.isArray(state['deed_deliveries']) ? state['deed_deliveries'] as any[] : []
  const idx = deliveries.findIndex(d => d.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })

  deliveries[idx] = { ...deliveries[idx], ...body, id: params.id }
  await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })
  return NextResponse.json({ item: deliveries[idx] })
}
