import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portal/quotes/[id]?token=<signed-token>
 * Public endpoint — customers view their quote via a signed link.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id
    const token   = request.nextUrl.searchParams.get('token') ?? ''

    if (!verifyQuoteToken(quoteId, token)) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 401 })
    }

    const state  = await loadAppState()
    const quotes = (state['deed_quotes'] ?? []) as Array<Record<string, unknown>>
    const quote  = quotes.find(q => q.id === quoteId)

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    return NextResponse.json({ quote })
  } catch (error) {
    console.error('Get portal quote error:', error)
    return NextResponse.json({ error: 'Failed to load quote' }, { status: 500 })
  }
}
