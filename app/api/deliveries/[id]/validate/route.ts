import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { postDeliveryValuationFromPayload } from '@/lib/inventory/valuation-hooks'
import { applyDeliveryStockMutation } from '@/lib/inventory/stock-transactions'
import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'
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

  // The delivery-status read-modify-write and the stock mutation it triggers
  // on first transition to Done are serialized under one advisory lock so a
  // concurrent request can neither lose this write nor observe/act on a
  // half-applied state between the stock mutation and the status write.
  const outcome = await withAppStateKeyLock('deed_deliveries', async () => {
    const state = await loadAppState(['deed_deliveries'])
    const deliveries: any[] = Array.isArray(state['deed_deliveries']) ? state['deed_deliveries'] as any[] : []
    const idx = deliveries.findIndex(d => d.id === params.id)
    if (idx === -1) return { status: 404 as const, error: 'Delivery not found' }

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
      return { status: 422 as const, error: fulfillmentError }
    }

    if (!wasDone && nextStatus === 'done') {
      if (deliveryDeliveredTotal({ lines: healedLines }) <= 0) {
        return { status: 422 as const, error: 'Cannot validate delivery — delivered quantity is 0' }
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
        return { status: 422 as const, error: 'Cannot validate delivery — no lines with delivered quantity' }
      }

      const stockResult = await applyDeliveryStockMutation({
        deliveryId: params.id,
        deliveryRef: String(previous?.ref || params.id),
        saleOrderId: String(previous?.saleOrderId ?? body.saleOrderId ?? ''),
        lines: doneLines,
        userId: session.user?.id,
      })
      if (!stockResult.ok) {
        return { status: 409 as const, error: stockResult.error }
      }
    }

    deliveries[idx] = next
    await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })

    return { status: 200 as const, item: deliveries[idx], wasDone, healedLines }
  })

  if (outcome.status !== 200) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  // Dual-write avg-cost + COGS on first transition to done. Never deletes blobs.
  // Idempotent via valuation_events — safe if client retries. Runs outside the
  // lock: it does not touch deed_deliveries and does not need to block others.
  let valuation: unknown = null
  if (!outcome.wasDone && outcome.item.status === 'done') {
    try {
      valuation = await postDeliveryValuationFromPayload({
        deliveryRef: String(outcome.item.ref || params.id),
        lines: outcome.healedLines,
        userId: session.user?.id,
      })
    } catch (err) {
      console.error('[deliveries/validate] valuation dual-write failed:', err)
    }
  }

  // Best-effort dual-write into delivery_notes/delivery_note_items — see
  // lib/delivery-mirror.ts. Runs outside the lock, after the response data
  // is already finalized; never blocks or fails validation.
  void mirrorDeliveryToPrisma(outcome.item).catch(() => {})

  return NextResponse.json({ item: outcome.item, valuation })
}
