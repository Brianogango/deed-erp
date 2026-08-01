import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { postDeliveryValuationFromPayload } from '@/lib/inventory/valuation-hooks'
import { applyDeliveryStockMutation } from '@/lib/inventory/stock-transactions'
import {
  deliveryDeliveredTotal,
  deliveryFulfillmentWriteError,
  effectiveDeliveryLineQty,
} from '@/lib/odoo-sales-flow'

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
  const nextStatus = body.status ?? previous?.status
  const lines = Array.isArray(body.lines) ? body.lines : (previous?.lines || [])

  // Heal qtyDone from serials before persistence so Done never stores delivered=0.
  const healedLines = (lines as any[]).map(line => {
    const qtyDone = effectiveDeliveryLineQty({
      qty: Number(line.qty) || 0,
      qtyDone: line.qtyDone,
      serialIds: line.serialIds,
    })
    return { ...line, qtyDone }
  })

  const next = {
    ...previous,
    ...body,
    id: params.id,
    status: nextStatus,
    lines: healedLines,
  }
  const fulfillmentError = deliveryFulfillmentWriteError(next, previous)
  if (fulfillmentError) {
    return NextResponse.json({ error: fulfillmentError }, { status: 422 })
  }

  if (!wasDone && nextStatus === 'done') {
    if (deliveryDeliveredTotal({ lines: healedLines }) <= 0) {
      return NextResponse.json({
        error: 'Cannot validate delivery — delivered quantity is 0',
      }, { status: 422 })
    }

    const doneLines = healedLines
      .map((line: any) => ({
        productId: String(line.productId ?? ''),
        productName: String(line.productName ?? ''),
        qty: effectiveDeliveryLineQty(line),
        serialIds: Array.isArray(line.serialIds) ? line.serialIds : [],
        sourceLocation: line.sourceLocation,
      }))
      .filter((line: { qty: number }) => line.qty > 0)

    if (doneLines.length === 0) {
      return NextResponse.json({
        error: 'Cannot validate delivery — no lines with delivered quantity',
      }, { status: 422 })
    }

    const stockResult = await applyDeliveryStockMutation({
      deliveryId: params.id,
      deliveryRef: String(previous?.ref || params.id),
      saleOrderId: String(previous?.saleOrderId ?? body.saleOrderId ?? ''),
      lines: doneLines,
      userId: session.user?.id,
    })
    if (!stockResult.ok) {
      return NextResponse.json({ error: stockResult.error }, { status: 409 })
    }
  }

  deliveries[idx] = next
  await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })

  // Dual-write avg-cost + COGS on first transition to done. Never deletes blobs.
  // Idempotent via valuation_events — safe if client retries.
  let valuation: unknown = null
  if (!wasDone && deliveries[idx].status === 'done') {
    try {
      valuation = await postDeliveryValuationFromPayload({
        deliveryRef: String(deliveries[idx].ref || params.id),
        lines: healedLines,
        userId: session.user?.id,
      })
    } catch (err) {
      console.error('[deliveries/validate] valuation dual-write failed:', err)
    }
  }

  return NextResponse.json({ item: deliveries[idx], valuation })
}
