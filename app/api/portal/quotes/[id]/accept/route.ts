import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/integrations/email'

/**
 * POST /api/portal/quotes/[id]/accept
 * Customer accepts a quote
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id

    // TODO: Update quote status in database
    // quote.status = 'accepted'
    // quote.acceptedDate = new Date()

    // TODO: Notify sales team via email
    await sendEmail({
      to: process.env.SALES_TEAM_EMAIL || 'sales@deed.co.ke',
      subject: `Quote Accepted: QT-2024-0001`,
      html: `
        <h2>Quote Accepted!</h2>
        <p>A customer has accepted quote <strong>QT-2024-0001</strong>.</p>
        <p>Please follow up to process the order.</p>
        <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/crm">View in CRM</a></p>
      `,
      text: 'A customer has accepted quote QT-2024-0001. Please follow up.',
    })

    return NextResponse.json({
      success: true,
      message: 'Quote accepted successfully',
    })
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json(
      { error: 'Failed to accept quote' },
      { status: 500 }
    )
  }
}
