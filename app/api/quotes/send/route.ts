import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'

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
      // Generate PDF inline (server-side)
      const pdfBuffer = await generateQuotePdfServer(quote)

      const result = await sendEmail({
        to: recipient.email,
        mailbox: 'sales',
        from: process.env.SALES_EMAIL || 'sales@deed.co.ke',
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

// Server-side PDF generation using jsPDF
async function generateQuotePdfServer(quote: any): Promise<Buffer> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(process.env.PDF_COMPANY_NAME || 'DEED TECHNOLOGIES LTD', 20, 20)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(process.env.PDF_COMPANY_ADDRESS || 'Westlands, Nairobi', 20, 26)
  doc.text(process.env.PDF_COMPANY_PHONE || '+254 20 123 4567', 20, 31)
  doc.text(process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke', 20, 36)

  // Quote info
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('QUOTATION', 150, 20)
  doc.setFontSize(11)
  doc.text(quote.ref, 150, 26)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date: ${quote.issueDate}`, 150, 31)
  doc.text(`Valid Until: ${quote.validUntil}`, 150, 36)

  // Customer info
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', 20, 50)
  doc.setFontSize(11)
  doc.text(quote.companyName, 20, 56)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Attention: ${quote.contactPersonName}`, 20, 61)

  // Table header
  let yPos = 75
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('#', 20, yPos)
  doc.text('Description', 30, yPos)
  doc.text('Qty', 110, yPos)
  doc.text('Unit Price', 130, yPos)
  doc.text('Total', 170, yPos)

  // Table rows
  yPos += 6
  doc.setFont('helvetica', 'normal')
  quote.lines.forEach((line: any, idx: number) => {
    doc.text(String(idx + 1), 20, yPos)
    doc.text(`${line.productName}`, 30, yPos)
    doc.text(String(line.qty), 110, yPos)
    doc.text(`KES ${line.unitPrice.toLocaleString()}`, 130, yPos)
    doc.text(`KES ${line.lineTotal.toLocaleString()}`, 170, yPos)
    yPos += 5
  })

  // Totals
  yPos += 10
  doc.setFont('helvetica', 'bold')
  doc.text(`Subtotal: KES ${quote.subtotal.toLocaleString()}`, 130, yPos)
  yPos += 5
  doc.text(`Tax: KES ${quote.taxTotal.toLocaleString()}`, 130, yPos)
  yPos += 5
  doc.setFontSize(12)
  doc.text(`TOTAL: KES ${quote.total.toLocaleString()}`, 130, yPos)

  // Terms
  yPos += 15
  doc.setFontSize(10)
  doc.text('Terms & Conditions', 20, yPos)
  yPos += 6
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Payment Terms: ${quote.paymentTerms}`, 20, yPos)

  if (quote.notes) {
    yPos += 5
    doc.text(`Notes: ${quote.notes}`, 20, yPos)
  }

  // Convert to buffer
  const pdfArrayBuffer = doc.output('arraybuffer')
  return Buffer.from(pdfArrayBuffer)
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
