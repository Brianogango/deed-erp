import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { recordHttpMetric, snapshotHttpMetrics } from '@/lib/http-metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer'])
    return NextResponse.json(snapshotHttpMetrics())
  })
}

/** Page 404 / client beacons — same-origin only, no body dump. */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const body = await request.json().catch(() => null) as { path?: unknown; status?: unknown } | null
    const path = typeof body?.path === 'string' ? body.path.slice(0, 160) : '/unknown'
    const status = Number(body?.status) === 404 ? 404 : 0
    if (status === 404) recordHttpMetric({ path, status: 404 })
    return NextResponse.json({ ok: true })
  })
}
