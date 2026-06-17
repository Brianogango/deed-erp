import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { sendEmail } from '@/lib/integrations/email'
import prisma from '@/lib/prisma'
import { normalizeQuoteForClient, normalizeQuotesForClient } from '@/lib/quote-normalization'


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

    const dbQuote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true, client: true, opportunity: true },
    })

    const state = await loadAppState()
    const cachedQuotes = (state['deed_quotes'] ?? []) as Array<Record<string, unknown>>
    const cachedQuote = cachedQuotes.find(q => q.id === quoteId)
    const quote = dbQuote ? normalizeQuoteForClient(dbQuote) : cachedQuote

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const acceptableStatuses = new Set(['sent', 'viewed', 'pending_approval', 'approved'])
    if (!acceptableStatuses.has(String(quote.status))) {
      return NextResponse.json(
        { error: `Quote cannot be accepted — current status is "${quote.status}".` },
        { status: 409 }
      )
    }

    const acceptedDate = new Date()

    if (dbQuote) {
      await prisma.quote.update({
        where: { id: quoteId },
        data: { status: 'approved' as any, approvedAt: acceptedDate },
      })

      const allQuotes = await prisma.quote.findMany({
        include: { items: true, client: true, opportunity: true },
        orderBy: { quoteDate: 'desc' },
      })
      await saveStoreKeys({ deed_quotes: JSON.stringify(normalizeQuotesForClient(allQuotes)) })
    } else {
      const idx = cachedQuotes.findIndex(q => q.id === quoteId)
      cachedQuotes[idx] = { ...quote, status: 'accepted', acceptedDate: acceptedDate.toISOString().slice(0, 10) }
      await saveStoreKeys({ deed_quotes: JSON.stringify(cachedQuotes) })
    }

    // Notify the sales team
    await sendEmail({
      to: process.env.SALES_TEAM_EMAIL ?? 'sales@deed.co.ke',
      mailbox: 'sales',
      from: process.env.SALES_EMAIL || 'sales@deed.co.ke',
      subject: `Quote Accepted: ${quote.ref ?? quote.quoteNumber ?? quoteId}`,
      html: `<h2>Quote Accepted</h2>
<p><strong>${quote.companyName ?? 'A customer'}</strong> has accepted quote <strong>${quote.ref ?? quote.quoteNumber ?? quoteId}</strong>.</p>
<p>Please follow up to process the order.</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/crm">View in CRM →</a></p>`,
      text: `${quote.companyName ?? 'A customer'} accepted quote ${quote.ref ?? quote.quoteNumber ?? quoteId}. Please follow up.`,
    }).catch(() => {}) // Email failure shouldn't block the acceptance

    return NextResponse.json({ success: true, message: 'Quote accepted successfully.' })
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json({ error: 'Failed to accept quote' }, { status: 500 })
  }
}
