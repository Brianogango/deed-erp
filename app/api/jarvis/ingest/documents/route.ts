import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { ingestAllKnowledge, ingestSopDocuments, ingestWebsiteDocuments } from '@/lib/jarvis/ingest'

const INGEST_ROLES = ['director', 'admin_officer']

function summarize(results: { status: string }[]) {
  return {
    documentCount: results.length,
    ready: results.filter(r => r.status === 'ready').length,
    unchanged: results.filter(r => r.status === 'unchanged').length,
    unsupported: results.filter(r => r.status === 'unsupported').length,
    failed: results.filter(r => r.status === 'failed').length,
  }
}

/**
 * POST /api/jarvis/ingest/documents
 * Admin-triggered re-ingestion of SOPs + public website knowledge into the
 * DIA document-search index. Body optional: { source?: 'all'|'sop'|'website' }
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(INGEST_ROLES)

    let source: 'all' | 'sop' | 'website' = 'all'
    try {
      const body = await request.json()
      if (body?.source === 'sop' || body?.source === 'website' || body?.source === 'all') {
        source = body.source
      }
    } catch {
      // empty body is fine
    }

    if (source === 'sop') {
      const results = await ingestSopDocuments()
      return NextResponse.json({ source, ...summarize(results), results })
    }

    if (source === 'website') {
      const results = await ingestWebsiteDocuments()
      return NextResponse.json({ source, ...summarize(results), results })
    }

    const { sop, website } = await ingestAllKnowledge()
    return NextResponse.json({
      source: 'all',
      sop: summarize(sop),
      website: summarize(website),
      results: { sop, website },
    })
  })
}
