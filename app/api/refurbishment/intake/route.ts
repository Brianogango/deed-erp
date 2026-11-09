import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { withAppStateKeyLock } from '@/lib/server-store'
import { intakeTaggedUnits } from '@/lib/refurbishment/unidentified.server'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'technical_lead', 'admin_officer', 'inventory_officer']

/** POST { productId, units: [{ cost?, note?, serial?, assetId?, issue?, productId? }], from?: { productId, location }, reference, destination?: 'with_issues' | 'refurbishment' } — machines in with asset IDs (and tags when the serial is unknown). */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const text = (v: unknown, max: number) => (v == null || String(v).trim() === '' ? undefined : String(v).trim().slice(0, max))
    const units = Array.isArray(body.units) ? body.units.map((u: any) => ({
      cost: u?.cost === '' || u?.cost == null ? null : Number(u.cost),
      note: text(u?.note, 300),
      serial: text(u?.serial, 100),
      assetId: text(u?.assetId, 20),
      issue: text(u?.issue, 300),
      productId: text(u?.productId, 64),
    })) : []
    if (units.some((u: { cost: number | null }) => u.cost != null && !(Number.isFinite(u.cost) && u.cost >= 0))) {
      return NextResponse.json({ error: 'Unit costs must be 0 or more' }, { status: 422 })
    }
    const from = body.from?.productId ? { productId: String(body.from.productId), location: String(body.from.location || 'warehouse') } : undefined
    const reference = String(body.reference || 'REFURB-IN').slice(0, 60)
    return withAppStateKeyLock('deed_serials', async () => {
      const destination = body.destination === 'with_issues' ? 'with_issues' as const : 'refurbishment' as const
      const result = await intakeTaggedUnits({ userId: user.id, userName: user.name, productId: String(body.productId || ''), units, from, reference, destination })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      await writeFinancialAudit({ userId: user.id, action: 'refurb_tagged_intake', entityType: 'serial', entityId: result.serials[0]?.id, newValues: { tags: result.serials.map(s => s.serial), costs: result.costs, from, reference } }).catch(() => {})
      return NextResponse.json(result)
    })
  })
}
