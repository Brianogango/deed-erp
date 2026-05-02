import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { loadAppState } from '@/lib/server-store'

const PORTAL_SECRET = process.env.CUSTOMER_PORTAL_SECRET ?? process.env.AUTH_SECRET ?? ''

/**
 * Generate a signed, time-limited token for a quote portal link.
 * Call this from the quote-send flow to embed in customer-facing URLs.
 */
export function generateQuoteToken(quoteId: string): string {
  const ts   = Date.now()
  const hmac = crypto.createHmac('sha256', PORTAL_SECRET).update(`${quoteId}:${ts}`).digest('hex')
  return Buffer.from(`${quoteId}:${ts}:${hmac}`).toString('base64url')
}

function verifyQuoteToken(quoteId: string, token: string): boolean {
  if (!PORTAL_SECRET || !token) return false
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts   = decoded.split(':')
    if (parts.length !== 3) return false
    const [id, tsStr, sig] = parts
    if (id !== quoteId) return false
    const ts = Number(tsStr)
    if (isNaN(ts) || Date.now() - ts > 30 * 24 * 60 * 60 * 1000) return false // 30-day expiry
    const expected = crypto.createHmac('sha256', PORTAL_SECRET).update(`${id}:${tsStr}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

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
