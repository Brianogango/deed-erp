import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { processStockRepairConsume } from '@/lib/inventory/valuation-service'
import { canAccessRecord, isRoleAllowed } from '@/lib/auth/authorization'
import { hasModuleAccess } from '@/lib/auth/access'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

type ConsumedLine = { productId: string; qty: number }

/**
 * Lines whose COGS this request should post.
 *
 * The caller may name them explicitly. QC stamps `usedDate` locally and only
 * then syncs the repair, so the server's copy still shows the parts
 * unconsumed while the POST is in flight — filtering on `usedDate` here made
 * every QC pass report "no consumed parts" and the repair-parts journal was
 * never written. Explicit lines are still bounded by what the repair actually
 * records, so a caller cannot post COGS for parts this repair never used.
 * With no explicit lines (the admin backfill, a finance retry) the stored
 * `usedDate` remains the selector.
 */
export function resolveConsumedLines(
  repair: { partsUsed?: unknown },
  requested?: unknown,
): { lines: ConsumedLine[]; rejected: string[] } {
  const recorded = new Map<string, number>()
  for (const part of Array.isArray(repair.partsUsed) ? repair.partsUsed : []) {
    const productId = String((part as any)?.productId ?? '')
    const qty = Math.floor(Number((part as any)?.qty) || 0)
    if (!productId || qty <= 0) continue
    recorded.set(productId, (recorded.get(productId) ?? 0) + qty)
  }

  if (Array.isArray(requested) && requested.length > 0) {
    const lines: ConsumedLine[] = []
    const rejected: string[] = []
    for (const row of requested) {
      const productId = String((row as any)?.productId ?? '')
      const allowed = recorded.get(productId)
      if (!productId || !allowed) {
        if (productId) rejected.push(productId)
        continue
      }
      const qty = Math.max(1, Math.min(allowed, Math.floor(Number((row as any)?.qty) || 1)))
      lines.push({ productId, qty })
    }
    return { lines, rejected }
  }

  const lines = (Array.isArray(repair.partsUsed) ? repair.partsUsed : [])
    .filter((p: any) => p?.usedDate && p?.productId && Number(p?.qty) > 0)
    .map((p: any) => ({
      productId: String(p.productId),
      qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
    }))
  return { lines, rejected: [] }
}

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
