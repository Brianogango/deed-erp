import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { identifyTaggedUnit } from '@/lib/refurbishment/unidentified.server'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/** Technicians find the serial; leads and inventory staff can too. */
const ROLES = ['director', 'technical_lead', 'technician', 'admin_officer', 'inventory_officer']

/** POST { serialId, serial, productId?, specs? } — record a tagged machine's real serial and model. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as Record<string, any>
    return withAppStateKeyLock('deed_serials', async () => {
      const result = await identifyTaggedUnit({
        userId: user.id,
        serialId: String(body.serialId || ''),
        serial: String(body.serial || ''),
        productId: body.productId ? String(body.productId) : undefined,
        specs: body.specs ? String(body.specs) : undefined,
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      await writeFinancialAudit({ userId: user.id, action: 'refurb_identify', entityType: 'serial', entityId: result.serial.id, newValues: { tag: result.serial.intakeTag, serial: result.serial.serial, productId: result.serial.productId, tookOver: result.removedSerialId ?? null } }).catch(() => {})
      return NextResponse.json(result)
    })
  })
}
