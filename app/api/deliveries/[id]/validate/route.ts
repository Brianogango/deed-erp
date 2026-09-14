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
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export async function POST(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await resolveRouteParams(params)

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // The delivery-status read-modify-write and the stock mutation it triggers
  // on first transition to Done are serialized under one advisory lock so a
  // concurrent request can neither lose this write nor observe/act on a
  // half-applied state between the stock mutation and the status write.
  const outcome = await withAppStateKeyLock('deed_deliveries', async () => {
    const state = await loadAppState(['deed_deliveries'])
    const deliveries: any[] = Array.isArray(state['deed_deliveries']) ? state['deed_deliveries'] as any[] : []
    const idx = deliveries.findIndex(d => d.id === id)
    if (idx === -1) return { status: 404 as const, error: 'Delivery not found' }

    const previous = deliveries[idx]
    const wasDone = previous?.status === 'done'
    const nextStatus = body.status ?? previous?.status
    const lines = Array.isArray(body.lines) ? body.lines : (previous?.lines || [])
    let doneValuation: unknown = null

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
      id,
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
        deliveryId: id,
        deliveryRef: String(previous?.ref || id),
        saleOrderId: String(previous?.saleOrderId ?? body.saleOrderId ?? ''),
        lines: doneLines,
        userId: session.user?.id,
      })
      if (!stockResult.ok) {
        return { status: 409 as const, error: stockResult.error }
      }

      try {
        doneValuation = await postDeliveryValuationFromPayload({
          deliveryRef: String(previous?.ref || id),
          lines: healedLines,
          userId: session.user?.id,
        })
      } catch (err) {
        console.error('[delivery] valuation failed after stock deduction:', err)
        doneValuation = { ok: false, reason: err instanceof Error ? err.message : 'Delivery valuation failed' }
      }
    }

    deliveries[idx] = next
    await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })

    return { status: 200 as const, item: deliveries[idx], wasDone, healedLines, valuation: doneValuation }
  })

  if (outcome.status !== 200) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  void mirrorDeliveryToPrisma(outcome.item).catch(() => {})

  return NextResponse.json({ item: outcome.item, valuation: outcome.valuation ?? null })
}
