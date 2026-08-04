import { NextRequest, NextResponse } from 'next/server'
import { sendEmail, generateQuoteEmail } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'
import { generateQuotePdfBuffer } from '@/lib/integrations/quote-pdf'

/**
 * POST /api/quotes/send
 * Send quote via email with PDF attachment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { quote, recipient, method = 'email', kind = 'initial' } = body

    if (!quote || !recipient) {
      return NextResponse.json(
        { error: 'Missing required fields: quote, recipient' },
        { status: 400 }
      )
    }

    if (method === 'email') {
      // Generate PDF server-side (shared with /api/integrations/send-quote)
      let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
      try {
        const pdfBuffer = await generateQuotePdfBuffer({
          ref: quote.ref,
          companyName: quote.companyName,
          contactPersonName: quote.contactPersonName ?? recipient.name,
          date: quote.issueDate,
          validUntil: quote.validUntil,
          lines: quote.lines ?? [],
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
          paymentTerms: quote.paymentTerms,
          notes: quote.notes,
        })
        attachments = [{
          filename: `${String(quote.ref).replace(/[/\\]/g, '-')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }]
      } catch (error) {
        console.error('Quote PDF generation failed:', error)
      }

      const emailContent = generateQuoteEmail({
        ref: quote.ref,
        companyName: quote.companyName,
        contactPersonName: recipient.name || quote.contactPersonName || quote.companyName,
        total: quote.total,
        validUntil: quote.validUntil,
        ownerName: quote.ownerName,
        lines: (quote.lines ?? []).map((line: { productName?: string; description?: string; qty?: number; lineTotal?: number; subtotal?: number }) => ({
          productName: line.productName || line.description || 'Item',
          qty: Number(line.qty ?? 1),
          lineTotal: Number(line.lineTotal ?? line.subtotal ?? 0),
        })),
        message: quote.message,
        kind: kind === 'update' ? 'update' : 'initial',
        pdfAttached: attachments.length > 0,
        pdfDownloadUrl: quote.pdfDownloadUrl,
      })

      const result = await sendEmail({
        to: recipient.email,
        mailbox: 'sales',
        replyTo: process.env.SALES_EMAIL || undefined,
        ...emailContent,
        attachments,
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        method: 'email',
      })
    }

    if (method === 'whatsapp') {
      const result = await sendWhatsAppMessage({
        to: recipient.phone,
        type: 'text',
        text: generateQuoteWhatsAppMessage(quote, recipient, kind === 'update' ? 'update' : 'initial'),
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        method: 'whatsapp',
      })
    }

    return NextResponse.json(
      { error: 'Invalid method. Use "email" or "whatsapp"' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Send quote error:', error)
    return NextResponse.json(
      { error: 'Failed to send quote' },
      { status: 500 }
    )
  }
}

function generateQuoteWhatsAppMessage(quote: any, recipient: any, kind: 'initial' | 'update'): string {
  const portalUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/quotes/${quote.id}`
    : ''
  const brand = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
  const salesEmail = process.env.SALES_EMAIL || process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke'

  return [
    `Hi ${recipient.name},`,
    '',
    kind === 'update'
      ? `Please find the updated quotation below:`
      : `Please find our quotation below:`,
    '',
    `*Quote ${quote.ref}*${kind === 'update' ? ' (Updated)' : ''}`,
    `Company: ${quote.companyName}`,
    `Total: KES ${Number(quote.total || 0).toLocaleString()}`,
    `Valid until: ${quote.validUntil}`,
    '',
    portalUrl ? `View online: ${portalUrl}` : 'Check your email for the detailed PDF.',
    '',
    'Best regards,',
    'Sales',
    brand,
    salesEmail,
  ].join('\n')
}
