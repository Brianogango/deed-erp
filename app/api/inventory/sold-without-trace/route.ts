import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { loadSoldWithoutTrace, returnSoldWithoutTrace } from '@/lib/inventory/sold-without-trace.server'

export const dynamic = 'force-dynamic'

const LOCATIONS = new Set(['warehouse', 'shop', 'repair_unit', 'pending_testing', 'quarantine'])

/** Units marked sold that no sale, delivery, invoice, POS sale, Kilimall order or warranty names. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('inventory.serials.manage')
    return NextResponse.json({ units: await loadSoldWithoutTrace() })
  })
}

/** Put chosen units back into stock, each re-checked under the serials lock. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('inventory.serials.manage')
    const body = await req.json().catch(() => ({})) as { serialIds?: unknown; reason?: unknown; location?: unknown }
    const serialIds = Array.isArray(body.serialIds) ? body.serialIds.map(String).filter(Boolean).slice(0, 500) : []
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    const location = String(body.location || 'warehouse')
    if (!serialIds.length) return NextResponse.json({ error: 'Choose at least one unit' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'Say why these units are going back into stock' }, { status: 422 })
    if (!LOCATIONS.has(location)) return NextResponse.json({ error: 'Unknown location' }, { status: 400 })
    const reference = `UNSOLD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`

    return withAppStateKeyLock('deed_serials', async () => {
      const result = await returnSoldWithoutTrace({ serialIds, reason, location, userId: user.id, reference })
      if (result.returned.length) {
        await writeFinancialAudit({
          userId: user.id,
          action: 'return_sold_without_sale_record',
          entityType: 'serial',
          entityId: reference,
          newValues: { reference, reason, location, serials: result.returned.map(u => u.serial) },
        }).catch(() => {})
      }
      return NextResponse.json({ ok: true, reference, ...result })
    })
  })
}
