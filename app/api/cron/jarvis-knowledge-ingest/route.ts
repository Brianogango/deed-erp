import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { ingestAllKnowledge } from '@/lib/jarvis/ingest'

function cronAuthorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const header = (req.headers.get('authorization') || '').trim()
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = (req.headers.get('x-cron-secret') || '').trim()
  const provided = bearer || alt
  if (!provided || provided.length !== secret.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  } catch {
    return false
  }
}

/**
 * Refresh DIA knowledge index (SOPs + deed.africa WordPress content).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      await requireRole(['director', 'admin_officer', 'super_admin'])
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
