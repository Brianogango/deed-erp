import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { ingestAllKnowledge } from '@/lib/jarvis/ingest'
import { cronAuthorized } from '@/lib/cron-auth'

/**
 * Refresh DIA knowledge index (SOPs + deed.africa WordPress content).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      await requirePermission('admin.jobs')
    }

    const { sop, website } = await ingestAllKnowledge()
    return NextResponse.json({
      ok: true,
      sop: {
        documentCount: sop.length,
        ready: sop.filter(r => r.status === 'ready').length,
        unchanged: sop.filter(r => r.status === 'unchanged').length,
      },
      website: {
        documentCount: website.length,
        ready: website.filter(r => r.status === 'ready').length,
        unchanged: website.filter(r => r.status === 'unchanged').length,
        failed: website.filter(r => r.status === 'failed').length,
      },
    })
  })
}
