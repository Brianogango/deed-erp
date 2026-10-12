import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { normalizeQuoteForClient } from '@/lib/quote-normalization'
import { findPortalDocument } from '@/lib/portal-document-lookup'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/quotes/[id]?token=<signed-token>
 * Public endpoint — customers view their quote (CRM Quote or Sales module
 * SaleOrder — see lib/portal-document-lookup.ts) via a signed link.
 */
async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params
  try {
    const quoteId = resolvedParams.id
    const token   = request.nextUrl.searchParams.get('token') ?? ''

    if (!verifyQuoteToken(quoteId, token)) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 401 })
    }

    const found = await findPortalDocument(quoteId)
    if (!found) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    return NextResponse.json({ quote: normalizeQuoteForClient(found.doc) })
  } catch {
    return NextResponse.json({ error: 'Failed to load quote' }, { status: 500 })
  }
}

export const GET = guardPortalRoute('quote-view', 300, handleGET)
