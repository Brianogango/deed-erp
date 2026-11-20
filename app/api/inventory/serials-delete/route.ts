import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { deleteSerialsFromSystem } from '@/lib/inventory/serial-delete.server'

export const dynamic = 'force-dynamic'

/**
 * Delete chosen units from the system (inventory, With Issues, refurbishment).
 * Director only. Units a sale, invoice, delivery, receipt, POS sale, Kilimall
 * order, warranty or repair names are refused (lib/inventory/serial-delete.ts).
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('inventory.serials.delete')
    const body = await req.json().catch(() => ({})) as { serialIds?: unknown; reason?: unknown }
    const serialIds = Array.isArray(body.serialIds) ? [...new Set(body.serialIds.map(String).filter(Boolean))].slice(0, 500) : []
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    if (!serialIds.length) return NextResponse.json({ error: 'Choose at least one unit' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'Say why these units are being deleted' }, { status: 422 })
    const reference = `DEL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`

    return withAppStateKeyLock('deed_serials', async () => {
      const result = await deleteSerialsFromSystem({ serialIds, reason, userId: user.id, reference })
      if (result.deleted.length) {
        await writeFinancialAudit({
          userId: user.id,
          action: 'delete_serials_from_system',
          entityType: 'serial',
          entityId: reference,
          newValues: { reference, reason, serials: result.deleted.map(d => `${d.serial} (${d.productName})`), refurbishmentJobsRemoved: result.jobsRemoved },
        }).catch(() => {})
      }
      return NextResponse.json({ ok: true, reference, ...result })
    })
  })
}
