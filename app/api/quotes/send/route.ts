import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'
import { generateQuotePdfBuffer } from '@/lib/integrations/quote-pdf'

/**
 * POST /api/quotes/send
 * Send quote via email with PDF attachment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { quote, recipient, method = 'email' } = body

    if (!quote || !recipient) {
      return NextResponse.json(
        { error: 'Missing required fields: quote, recipient' },
        { status: 400 }
      )
    }

    if (method === 'email') {
      // Generate PDF server-side (shared with /api/integrations/send-quote)
      const pdfBuffer = await generateQuotePdfBuffer({
        ref: quote.ref,
        companyName: quote.companyName,
        contactPersonName: quote.contactPersonName,
        date: quote.issueDate,
        validUntil: quote.validUntil,
        lines: quote.lines ?? [],
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        total: quote.total,
        paymentTerms: quote.paymentTerms,
        notes: quote.notes,
      })

      const result = await sendEmail({
        to: recipient.email,
        mailbox: 'sales',
        replyTo: process.env.SALES_EMAIL || undefined,
        subject: `Quote ${quote.ref} from ${process.env.PDF_COMPANY_NAME || 'Deed ERP'}`,
        html: generateQuoteEmailHtml(quote, recipient),
        text: generateQuoteEmailText(quote, recipient),
        attachments: [
          {
            filename: `${quote.ref}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
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
        text: generateQuoteWhatsAppMessage(quote, recipient),
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

function generateQuoteEmailHtml(quote: any, recipient: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #875BF7; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; }
    .quote-summary { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
    .total { font-size: 18px; font-weight: bold; color: #875BF7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 24px;">${process.env.PDF_COMPANY_NAME || 'Deed Technologies'}</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Your Technology Partner</p>
    </div>
    
    <div class="content">
      <p>Hello ${recipient.name},</p>
      
      <p>Thank you for your interest! We're pleased to present our quotation.</p>
      
      <div class="quote-summary">
        <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #875BF7;">
          Quote ${quote.ref}
        </h2>
        
        <p><strong>Company:</strong> ${quote.companyName}</p>
        <p><strong>Total Amount (incl. VAT):</strong> <span class="total">KES ${quote.total.toLocaleString()}</span></p>
        <p><strong>Valid Until:</strong> ${quote.validUntil}</p>
      </div>
      
      <p>Please find the detailed quotation attached as a PDF.</p>
      
      <p>To accept this quote or discuss further, please reply to this email or contact ${quote.ownerName}.</p>
      
      <p>Best regards,<br>
      <strong>${quote.ownerName}</strong><br>
      ${process.env.PDF_COMPANY_NAME || 'Deed Technologies'}<br>
      ${process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke'} | ${process.env.PDF_COMPANY_PHONE || '+254 20 123 4567'}</p>
    </div>
    
    <div class="footer">
      <p>${process.env.PDF_COMPANY_NAME || 'Deed Technologies'} · ${process.env.PDF_COMPANY_ADDRESS || 'Nairobi, Kenya'}</p>
      <p style="font-size: 10px; color: #999;">This is an automated message from Deed ERP.</p>
    </div>
  </div>
</body>
</html>
  `
}

function generateQuoteEmailText(quote: any, recipient: any): string {
  return `
Quote ${quote.ref} from ${process.env.PDF_COMPANY_NAME || 'Deed Technologies'}

Hello ${recipient.name},

Thank you for your interest! We're pleased to present our quotation.

Quote Details:
Company: ${quote.companyName}
Total Amount (incl. VAT): KES ${quote.total.toLocaleString()}
Valid Until: ${quote.validUntil}

Please find the detailed quotation attached as a PDF.

To accept this quote or discuss further, please reply to this email or contact ${quote.ownerName}.

Best regards,
${quote.ownerName}
${process.env.PDF_COMPANY_NAME || 'Deed Technologies'}
${process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke'} | ${process.env.PDF_COMPANY_PHONE || '+254 20 123 4567'}
  `.trim()
}

function generateQuoteWhatsAppMessage(quote: any, recipient: any): string {
  const portalUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/quotes/${quote.id}`
    : ''

  return `
Hi ${recipient.name},

Thank you for your interest! Your quotation is ready:

*Quote ${quote.ref}*
Company: ${quote.companyName}
Total: KES ${quote.total.toLocaleString()}
Valid Until: ${quote.validUntil}

${portalUrl ? `View and accept online: ${portalUrl}` : 'Please check your email for the detailed quote.'}

To discuss or accept, please reply to this message or contact:
${quote.ownerName}
${process.env.PDF_COMPANY_NAME || 'Deed Technologies'}
${process.env.PDF_COMPANY_PHONE || '+254 20 123 4567'}

Thank you!
  `.trim()
}
