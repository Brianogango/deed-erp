import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { processStockRepairConsume } from '@/lib/inventory/valuation-service'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

/**
 * POST /api/repairs/[id]/parts-cogs
 * Post the repair-parts COGS journal (Dr 6301 / Cr 1200) for parts consumed
 * on this repair (partsUsed with usedDate set). Idempotent per repair+product
 * via the valuation event key — safe to call on every QC pass.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!WRITE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as any[] : []
  const repair = repairs.find(r => r?.id === params.id || r?.ref === params.id)
  if (!repair) return NextResponse.json({ error: 'Repair not found' }, { status: 404 })

  const consumed = (Array.isArray(repair.partsUsed) ? repair.partsUsed : [])
    .filter((p: any) => p?.usedDate && p?.productId && Number(p?.qty) > 0)
  if (consumed.length === 0) {
    return NextResponse.json({ ok: true, posted: 0, reason: 'no_consumed_parts' })
  }

  const results = []
  for (const part of consumed) {
    try {
      const result = await processStockRepairConsume({
        productId: String(part.productId),
        qty: Math.max(1, Math.floor(Number(part.qty) || 1)),
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
    errors: failed.length ? failed : undefined,
  }, { status: failed.length ? 422 : 200 })
}
