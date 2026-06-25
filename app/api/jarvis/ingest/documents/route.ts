import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { ingestSopDocuments } from '@/lib/jarvis/ingest'

const INGEST_ROLES = ['director', 'admin_officer']

/**
 * POST /api/jarvis/ingest/documents
 * Admin-triggered re-ingestion of company SOP documents into the JARVIS
 * document-search index. Not part of the chat flow — run this after SOPs
 * are added/edited so search_documents can find the new content.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(INGEST_ROLES)
    const results = await ingestSopDocuments()
    return NextResponse.json({
      documentCount: results.length,
      ready: results.filter(r => r.status === 'ready').length,
      unchanged: results.filter(r => r.status === 'unchanged').length,
      unsupported: results.filter(r => r.status === 'unsupported').length,
      results,
    })
  })
}
