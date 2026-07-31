import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { postDeliveryValuationFromPayload } from '@/lib/inventory/valuation-hooks'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState(['deed_deliveries'])
  const deliveries: any[] = Array.isArray(state['deed_deliveries']) ? state['deed_deliveries'] as any[] : []
  const idx = deliveries.findIndex(d => d.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })

  const previous = deliveries[idx]
  const wasDone = previous?.status === 'done'
  deliveries[idx] = { ...previous, ...body, id: params.id }
  await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })

  // Dual-write avg-cost + COGS on first transition to done. Never deletes blobs.
  // Idempotent via valuation_events — safe if client retries.
  let valuation: unknown = null
  if (!wasDone && deliveries[idx].status === 'done') {
    try {
      valuation = await postDeliveryValuationFromPayload({
        deliveryRef: String(deliveries[idx].ref || params.id),
        lines: Array.isArray(body.lines) ? body.lines : (deliveries[idx].lines || []),
        userId: session.user?.id,
      })
    } catch (err) {
      console.error('[deliveries/validate] valuation dual-write failed:', err)
    }
  }

  return NextResponse.json({ item: deliveries[idx], valuation })
}
