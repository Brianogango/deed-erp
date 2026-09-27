import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { processStockRepairConsume } from '@/lib/inventory/valuation-service'
import { canAccessRecord, isRoleAllowed } from '@/lib/auth/authorization'
import { hasModuleAccess } from '@/lib/auth/access'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { resolveConsumedLines } from '@/lib/repair/parts-cogs-lines'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

/**
 * POST /api/repairs/[id]/parts-cogs
 * Post the repair-parts COGS journal (Dr 6301 / Cr 1200) for parts consumed
 * on this repair. Idempotent per repair+product via the valuation event key —
 * safe to call on every QC pass.
 *
 * Body (optional): { parts: [{ productId, qty }] } — the lines this pass
 * consumed. See resolveConsumedLines for why the caller names them.
 */
export async function POST(req: NextRequest, ctx: { params: RouteParams<{ id: string }> }) {
  const { id } = await resolveRouteParams(ctx.params)
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  // Roles are normalized so a Technical Lead stored as `lead_tech` (or a
  // Director stored as `super_admin`) is not silently locked out.
  if (!isRoleAllowed(user?.role, WRITE_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!hasModuleAccess(user, 'repair')) {
    return NextResponse.json({ error: 'Forbidden — no repair module access' }, { status: 403 })
  }

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as any[] : []
  const repair = repairs.find(r => r?.id === id || r?.ref === id)
  if (!repair) return NextResponse.json({ error: 'Repair not found' }, { status: 404 })

  // Posting COGS consumes FIFO inventory, so it follows the same record
  // firewall as editing the repair — a technician may only post their own job.
  const allowed = canAccessRecord(
    user.role,
    'repair',
    { assignedTechnicianId: repair.assignedTechnicianId, createdByUserId: repair.createdByUserId },
    user.id,
    { actsAsTechnician: Boolean(user.actsAsTechnician) },
  )
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden — this repair is not assigned to you' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as { parts?: unknown } | null
  const { lines: consumed, rejected } = resolveConsumedLines(repair, body?.parts)
  if (consumed.length === 0) {
    return NextResponse.json({ ok: true, posted: 0, reason: 'no_consumed_parts', rejected: rejected.length ? rejected : undefined })
  }

  const results = []
  for (const part of consumed) {
    try {
      const result = await processStockRepairConsume({
        productId: part.productId,
        qty: part.qty,
        reference: String(repair.ref ?? repair.id),
        userId: session.user.id,
      })
      results.push({ productId: part.productId, ...result })
    } catch (err) {
      results.push({ productId: part.productId, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  const posted = results.filter(r => !(r as any).skipped && !(r as any).error).length
  const failed = results.filter(r => (r as any).error)
  return NextResponse.json({
    ok: failed.length === 0,
    posted,
    skipped: results.length - posted - failed.length,
    rejected: rejected.length ? rejected : undefined,
    errors: failed.length ? failed : undefined,
  }, { status: failed.length ? 422 : 200 })
}
