import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { checkStoreParity, runStoreParityJob } from '@/lib/store-parity'

/**
 * Step 7 of docs/PRISMA_STATE_CUTOVER.md, as an endpoint.
 *
 * GET  — read-only comparison, for certifying a `dual` soak.
 * POST — same comparison, and raises the drift alert if the counts disagree.
 *
 * Authenticates with CRON_SECRET (so the schedule can call it) or the
 * `admin.jobs` permission, matching /api/cron/infra.
 */
function secretOk(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || '').trim()
  const auth = String(request.headers.get('authorization') || '').trim()
  const supplied = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : String(request.headers.get('x-cron-secret') || '').trim()
  if (!expected || !supplied || expected.length !== supplied.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) } catch { return false }
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!secretOk(request)) await requirePermission('admin.jobs')
    const report = await checkStoreParity()
    return NextResponse.json(report, { status: report.inParity ? 200 : 409 })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!secretOk(request)) await requirePermission('admin.jobs')
    const report = await runStoreParityJob()
    return NextResponse.json(report, { status: report.inParity ? 200 : 409 })
  })
}
