import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { runInfraWorker } from '@/lib/infra/worker'
import { refreshCoreReportSnapshots } from '@/lib/infra/report-snapshots'
import { infraRedisBackend } from '@/lib/infra/redis'
import { objectStoreDriver } from '@/lib/infra/object-store'
import { reportingDatabaseUrl } from '@/lib/infra/reporting-db'

function secretOk(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || '').trim()
  const auth = String(request.headers.get('authorization') || '').trim()
  const supplied = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : String(request.headers.get('x-cron-secret') || '').trim()
  if (!expected || !supplied || expected.length !== supplied.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) } catch { return false }
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!secretOk(request)) await requireRole(['director', 'admin_officer', 'super_admin'])
    const refresh = await refreshCoreReportSnapshots()
    const worker = await runInfraWorker()
    return NextResponse.json({
      ok: true,
      redis: await infraRedisBackend(),
      objectStore: objectStoreDriver(),
      reportingReplica: Boolean(reportingDatabaseUrl()),
      refresh,
      worker,
    })
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
