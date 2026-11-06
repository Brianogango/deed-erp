import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { harvestUnit } from '@/lib/refurbishment/unidentified.server'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/** Same people who may write a machine off. */
const ROLES = ['director', 'technical_lead', 'admin_officer', 'inventory_officer']

/** POST { serialId, reference, reason, parts: [{ productId, qty, unitValue }] } — strip a dead machine for parts. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const reason = String(body.reason || '').trim().slice(0, 300)
    if (!reason) return NextResponse.json({ error: 'Say why it cannot be repaired' }, { status: 422 })
    const parts = Array.isArray(body.parts) ? body.parts.map((p: any) => ({ productId: String(p?.productId || ''), qty: Number(p?.qty), unitValue: Math.max(0, Number(p?.unitValue) || 0) })) : []
    return withAppStateKeyLock('deed_serials', async () => {
      const result = await harvestUnit({ userId: user.id, serialId: String(body.serialId || ''), reference: String(body.reference || '').slice(0, 60) || 'HARVEST', reason, parts })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      await writeFinancialAudit({ userId: user.id, action: 'refurb_harvest', entityType: 'serial', entityId: String(body.serialId), newValues: { serial: result.serial, machineCost: result.machineCost, partsValue: result.partsValue, parts: result.parts, reason } }).catch(() => {})
      return NextResponse.json(result)
    })
  })
}
