import { NextRequest, NextResponse } from 'next/server'
import { verifyQuoteToken } from '@/lib/quote-token'
import { sendEmail } from '@/lib/integrations/email'
import prisma from '@/lib/prisma'
import {
  findPortalDocument,
  savePortalDocument,
  QUOTE_ACCEPTABLE_STATUSES,
  SALE_ORDER_ACCEPTABLE_STATUSES,
} from '@/lib/portal-document-lookup'

/**
 * POST /api/portal/quotes/[id]/accept?token=<signed-token>
 * Customer accepts their own quote — token proves they own the link. Works
 * for both a CRM Quote and a Sales module SaleOrder (see
 * lib/portal-document-lookup.ts).
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

    const found = await findPortalDocument(quoteId)
    if (!found) {
      return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
    }

    const doc = found.doc
    const ref = String(doc.ref ?? doc.quoteNumber ?? quoteId)
    const partyName = String(doc.companyName ?? doc.customerName ?? 'A customer')

    if (found.source === 'quote') {
      if (!QUOTE_ACCEPTABLE_STATUSES.has(String(doc.status))) {
        return NextResponse.json(
          { error: `Quote cannot be accepted — current status is "${doc.status}".` },
          { status: 409 },
        )
      }
      await savePortalDocument(found, { ...doc, status: 'accepted', acceptedDate: new Date().toISOString().slice(0, 10) })
    } else {
      // A SaleOrder is never auto-confirmed by a customer's portal click —
      // confirming reserves stock and runs credit checks that need staff
      // review. Stamp acceptedAt as an immutable commercial snapshot and
      // notify the sales team to confirm the order themselves.
      if (!SALE_ORDER_ACCEPTABLE_STATUSES.has(String(doc.status))) {
        return NextResponse.json(
          { error: `Quotation cannot be accepted — current status is "${doc.status}".` },
          { status: 409 },
        )
      }
      if (doc.acceptedAt) {
        return NextResponse.json({ success: true, message: 'Quote already accepted.' })
      }
      const acceptedAt = new Date().toISOString()
      const notes = `${String(doc.notes ?? '')}\n[Customer accepted online ${acceptedAt.slice(0, 10)}]`.trim()
      await savePortalDocument(found, { ...doc, notes, acceptedAt })
      // Durable Prisma stamp so server commercial freeze survives blob races.
      // Accessing prisma can throw synchronously when DATABASE_URL is unset
      // (tests / misconfigured hosts) — never fail the portal accept for that.
      try {
        await prisma.saleOrder.update({
          where: { id: quoteId },
          data: { acceptedAt: new Date(acceptedAt), notes },
        })
      } catch {
        /* blob stamp is enough for portal UX; staff confirm heals Prisma */
      }
    }

    await sendEmail({
      to: process.env.SALES_TEAM_EMAIL ?? 'sales@deed.co.ke',
      mailbox: 'sales',
      replyTo: process.env.SALES_EMAIL || undefined,
      subject: `Quote Accepted: ${ref}`,
      html: `<h2>Quote Accepted</h2>
<p><strong>${partyName}</strong> has accepted quote <strong>${ref}</strong> online.</p>
<p>Please follow up to confirm and process the order.</p>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/${found.source === 'quote' ? 'crm' : 'sales'}">View →</a></p>`,
      text: `${partyName} accepted quote ${ref} online. Please follow up.`,
    }).catch(() => {}) // Email failure shouldn't block the acceptance

    return NextResponse.json({ success: true, message: 'Quote accepted successfully.' })
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json({ error: 'Failed to accept quote' }, { status: 500 })
  }
}
