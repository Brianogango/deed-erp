import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
