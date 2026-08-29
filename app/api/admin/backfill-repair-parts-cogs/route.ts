import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { processStockRepairConsume } from '@/lib/inventory/valuation-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/backfill-repair-parts-cogs
 * One-off: post the repair-parts COGS journal (Dr 6301 / Cr 1200) for every
 * repair with already-consumed parts (usedDate set). Idempotent — the
 * valuation event key skips lines already posted. Director only.
 */
export async function POST() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') {
    return NextResponse.json({ error: 'Director only' }, { status: 403 })
  }

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as any[] : []

  let posted = 0
  let skipped = 0
  const errors: Array<{ repair: string; productId: string; error: string }> = []

  for (const repair of repairs) {
    const consumed = (Array.isArray(repair?.partsUsed) ? repair.partsUsed : [])
      .filter((p: any) => p?.usedDate && p?.productId && Number(p?.qty) > 0)
    for (const part of consumed) {
      try {
        const result = await processStockRepairConsume({
          productId: String(part.productId),
          qty: Math.max(1, Math.floor(Number(part.qty) || 1)),
          reference: String(repair.ref ?? repair.id),
          userId: session.user.id,
        })
        if (result.skipped) skipped++
        else posted++
      } catch (err) {
        errors.push({
          repair: String(repair.ref ?? repair.id),
          productId: String(part.productId),
          error: err instanceof Error ? err.message : 'failed',
        })
      }
    }
  }

  return NextResponse.json({ posted, skipped, errors: errors.length ? errors : undefined })
}
