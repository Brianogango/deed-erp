/**
 * POST /api/deliveries/:id/reverse
 *
 * Undo a delivery.
 *
 * A validated (done) delivery put stock in the customer's hands: reversing it
 * returns the quantities, frees the serials, restores the reservation and
 * reverses the COGS journal, leaving the delivery cancelled with an audit
 * trail. An open delivery never moved stock, so it is simply cancelled and its
 * reservation released.
 *
 * Without this, a delivery raised in error — a backorder for stock that had
 * already shipped, say — could not be undone: its serials stayed sold and the
 * delivery stayed on the order forever.
 *
 * Body: { reason?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { reverseDeliveryStockMutation } from '@/lib/inventory/stock-transactions'
import { reverseJournalEntry } from '@/lib/accounting/journal-service'
import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'
import { effectiveDeliveryLineQty, normalizeDeliveryStatus } from '@/lib/odoo-sales-flow'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

const REVERSE_ROLES = ['director', 'inventory_officer', 'admin_officer']

export async function POST(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(REVERSE_ROLES)
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({})) as { reason?: string }
    const reason = String(body.reason ?? '').trim().slice(0, 240)

    const outcome = await withAppStateKeyLock('deed_deliveries', async () => {
      const state = await loadAppState(['deed_deliveries'])
      const deliveries: any[] = Array.isArray(state['deed_deliveries']) ? state['deed_deliveries'] as any[] : []
      const idx = deliveries.findIndex(d => d.id === id)
      if (idx === -1) return { status: 404 as const, error: 'Delivery not found' }

      const delivery = deliveries[idx]
      const status = normalizeDeliveryStatus(delivery.status)
      if (status === 'cancelled') {
        return { status: 409 as const, error: 'This delivery is already cancelled' }
      }

      const lines = (Array.isArray(delivery.lines) ? delivery.lines : [])
        .map((line: any) => ({
          productId: String(line.productId ?? ''),
          productName: String(line.productName ?? 'Item'),
          qty: effectiveDeliveryLineQty(line),
          serialIds: Array.isArray(line.serialIds) ? line.serialIds : [],
          sourceLocation: line.sourceLocation,
        }))
        .filter((line: { productId: string; qty: number }) => line.productId && line.qty > 0)

      // Only a validated delivery moved stock. Reversing an open one would
      // credit quantities that never left.
      if (status === 'done' && lines.length > 0) {
        await reverseDeliveryStockMutation({
          deliveryId: delivery.id,
          deliveryRef: String(delivery.ref ?? delivery.id),
          saleOrderId: String(delivery.saleOrderId ?? ''),
          lines,
        })
      }

      deliveries[idx] = {
        ...delivery,
        status: 'cancelled',
        reversedAt: new Date().toISOString(),
        reversedById: actor.id,
        reversedReason: reason || undefined,
        // Keep the picked serials on the record for the audit trail, but the
        // serials themselves are back in stock.
        warrantyCreated: false,
      }
      await saveStoreKeys({ deed_deliveries: JSON.stringify(deliveries) })
      return { status: 200 as const, item: deliveries[idx], wasDone: status === 'done' }
    })

    if (outcome.status !== 200) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    // Bookkeeping follows the warehouse: a failure here must not leave the
    // stock reversed but the delivery still open.
    let journalReversed: string | null = null
    if (outcome.wasDone) {
      try {
        const reversal = await reverseJournalEntry(`JRN/STK/DEL/${outcome.item.ref}`.slice(0, 80), actor.id)
        journalReversed = reversal?.ref ?? null
      } catch (err) {
        console.error('[delivery-reverse] COGS journal reversal failed:', err)
      }
    }

    void mirrorDeliveryToPrisma(outcome.item).catch(() => {})

    return NextResponse.json({
      item: outcome.item,
      reversedStock: outcome.wasDone,
      journalReversed,
    })
  })
}
