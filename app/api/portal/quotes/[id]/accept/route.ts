import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { sendEmail } from '@/lib/integrations/email'


/**
 * POST /api/portal/quotes/[id]/accept?token=<signed-token>
 * Customer accepts their own quote — token proves they own the link.
 */
export async function POST(
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
    const idx    = quotes.findIndex(q => q.id === quoteId)

    if (idx === -1) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const quote = quotes[idx]
    if (quote.status !== 'sent' && quote.status !== 'viewed') {
      return NextResponse.json(
        { error: `Quote cannot be accepted — current status is "${quote.status}".` },
        { status: 409 }
      )
    }

    // Update the quote status in the store
    quotes[idx] = { ...quote, status: 'accepted', acceptedDate: new Date().toISOString().slice(0, 10) }
    await saveStoreKeys({ deed_quotes: JSON.stringify(quotes) })

    // Notify the sales team
    await sendEmail({
      to: process.env.SALES_TEAM_EMAIL ?? 'sales@deed.co.ke',
      subject: `Quote Accepted: ${quote.ref ?? quoteId}`,
      html: `<h2>Quote Accepted</h2>
<p><strong>${quote.companyName ?? 'A customer'}</strong> has accepted quote <strong>${quote.ref ?? quoteId}</strong>.</p>
<p>Please follow up to process the order.</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/crm">View in CRM →</a></p>`,
      text: `${quote.companyName ?? 'A customer'} accepted quote ${quote.ref ?? quoteId}. Please follow up.`,
    }).catch(() => {}) // Email failure shouldn't block the acceptance

    return NextResponse.json({ success: true, message: 'Quote accepted successfully.' })
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json({ error: 'Failed to accept quote' }, { status: 500 })
  }
}
