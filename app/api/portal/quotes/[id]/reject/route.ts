import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { sendEmail } from '@/lib/integrations/email'
import {
  findPortalDocument,
  savePortalDocument,
  QUOTE_ACCEPTABLE_STATUSES,
  SALE_ORDER_ACCEPTABLE_STATUSES,
} from '@/lib/portal-document-lookup'

/**
 * POST /api/portal/quotes/[id]/reject?token=<signed-token>
 * Customer declines their own quote — mirrors accept/route.ts. Previously
 * there was no reject path at all on the customer portal for either
 * document type — a customer who wanted to decline had no online way to
 * say so, only Accept existed.
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

    const body = await request.json().catch(() => ({} as { reason?: string }))
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

    const found = await findPortalDocument(quoteId)
    if (!found) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const doc = found.doc
    const ref = String(doc.ref ?? doc.quoteNumber ?? quoteId)
    const partyName = String(doc.companyName ?? doc.customerName ?? 'A customer')
    const today = new Date().toISOString().slice(0, 10)
    const reasonSuffix = reason ? ` — ${reason}` : ''

    if (found.source === 'quote') {
      if (!QUOTE_ACCEPTABLE_STATUSES.has(String(doc.status))) {
        return NextResponse.json(
          { error: `Quote cannot be declined — current status is "${doc.status}".` },
          { status: 409 },
        )
      }
      await savePortalDocument(found, { ...doc, status: 'rejected', rejectedDate: today, rejectionReason: reason || undefined })
    } else {
      if (!SALE_ORDER_ACCEPTABLE_STATUSES.has(String(doc.status))) {
        return NextResponse.json(
          { error: `Quotation cannot be declined — current status is "${doc.status}".` },
          { status: 409 },
        )
      }
      // Matches the internal "Mark rejected" staff action (append-only
      // note) — a customer decline doesn't auto-cancel the quotation, so
      // staff can still follow up before writing it off.
      const notes = `${String(doc.notes ?? '')}\n[Customer rejected online ${today}${reasonSuffix}]`.trim()
      await savePortalDocument(found, { ...doc, notes })
    }

    await sendEmail({
      to: process.env.SALES_TEAM_EMAIL ?? 'sales@deed.co.ke',
      mailbox: 'sales',
      replyTo: process.env.SALES_EMAIL || undefined,
      subject: `Quote Declined: ${ref}`,
      html: `<h2>Quote Declined</h2>
<p><strong>${partyName}</strong> has declined quote <strong>${ref}</strong> online.${reason ? `</p><p>Reason: ${reason}` : ''}</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/${found.source === 'quote' ? 'crm' : 'sales'}">View →</a></p>`,
      text: `${partyName} declined quote ${ref} online.${reason ? ` Reason: ${reason}` : ''}`,
    }).catch(() => {})

    return NextResponse.json({ success: true, message: 'Quote declined.' })
  } catch (error) {
    console.error('Reject quote error:', error)
    return NextResponse.json({ error: 'Failed to decline quote' }, { status: 500 })
  }
}
