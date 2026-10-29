import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { applySerialWriteOffMutation } from '@/lib/inventory/stock-transactions'
import { postAdjustmentValuation } from '@/lib/inventory/valuation-hooks'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/** A write-off is a loss decision, and bringing a unit back reverses it. */
const ROLES = ['director', 'technical_lead', 'admin_officer', 'inventory_officer']

/**
 * Write a serial-tracked unit off, or bring it back.
 *
 * write_off: serial → written off, on-hand −1, and its value moves out of
 *   inventory into the write-off expense (Dr 6306 / Cr inventory, at the
 *   product's current cost). The cost used is returned so the restore can
 *   reverse exactly that amount.
 * restore:  serial → back to `restoreTo`, on-hand +1, and the same cost goes
 *   back into inventory against the write-off expense (Dr inventory / Cr
 *   6306), so the loss is reversed. Units written off before this booking
 *   existed (`unitCost` not given) only get their status back — nothing was
 *   taken off the books for them, so nothing is added back.
 *
 * The serial's status is checked under the serials lock, so neither can be
 * applied twice.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as {
      serialId?: string; action?: string; reference?: string; reason?: string
      unitCost?: number; restoreTo?: { status?: string; location?: string }
    }
    const serialId = String(body.serialId ?? '').trim()
    const action = body.action === 'restore' ? 'restore' : body.action === 'write_off' ? 'write_off' : null
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    const reference = String(body.reference ?? '').trim().slice(0, 60)
    if (!serialId || !action) return NextResponse.json({ error: 'serialId and action (write_off or restore) are required' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'Give a reason' }, { status: 422 })
    const unitCost = Number(body.unitCost)
    const reversesBooking = action === 'restore' && Number.isFinite(unitCost) && unitCost > 0
    const restoreTo = action === 'restore'
      ? { status: String(body.restoreTo?.status || 'refurbishment'), location: String(body.restoreTo?.location || 'repair_unit') }
      : undefined

    return withAppStateKeyLock('deed_serials', async () => {
      const stock = await applySerialWriteOffMutation({
        serialId, reference: reference || serialId, reason, action, restoreTo, userId: user.id,
        // A unit written off before this booking existed never left on-hand here.
        adjustOnHand: action === 'write_off' || reversesBooking,
      })
      if (!stock.ok) return NextResponse.json({ error: stock.error }, { status: stock.status ?? 422 })

      // Unique per event: a unit can be written off, restored and written off again.
      const valuationRef = `${reference || stock.serial} ${action === 'write_off' ? 'WO' : 'WO-REV'} ${stock.serial} ${Date.now()}`
      let cost = 0
      let valuation: unknown = null
      if (action === 'write_off' || reversesBooking) {
        valuation = await postAdjustmentValuation({
          adjustmentRef: valuationRef,
          productId: stock.productId,
          type: action === 'write_off' ? 'subtract' : 'add',
          qty: 1,
          ...(action === 'restore' ? { unitCost, reversesWriteOff: true } : {}),
          userId: user.id,
        }).catch(err => ({ ok: false, reason: err instanceof Error ? err.message : 'valuation_failed' }))
        const result = (valuation as { ok?: boolean; result?: { totalCost?: number } } | null)?.result
        cost = action === 'write_off' ? Math.round((Number(result?.totalCost) || 0) * 100) / 100 : unitCost
      }

      await writeFinancialAudit({
        userId: user.id,
        action: action === 'write_off' ? 'write_off_serial' : 'restore_written_off_serial',
        entityType: 'serial',
        entityId: serialId,
        newValues: { serial: stock.serial, productId: stock.productId, reference, reason, cost, valuationRef },
      }).catch(() => {})

      return NextResponse.json({ ok: true, serial: stock.serial, cost, valuationRef, valuation })
    })
  })
}
