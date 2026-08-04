import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail, generateQuoteEmail, logEmailForDev } from '@/lib/integrations/email'
import { sendQuoteViaWhatsApp, logWhatsAppForDev } from '@/lib/integrations/whatsapp'
import { generateQuotePdfBuffer } from '@/lib/integrations/quote-pdf'

/**
 * POST /api/integrations/send-quote
 * 
 * Send quote to customer via email and/or WhatsApp
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid request payload'), { status: 400 })
    }

    const payload = body as {
      quoteId: string
      quote: {
        ref: string
        companyName: string
        contactPersonName: string
        contactEmail: string
        contactPhone: string
        date?: string
        subtotal?: number
        taxTotal?: number
        total: number
        validUntil: string
        ownerName: string
        paymentTerms?: string
        notes?: string
        lines: Array<{ productName: string; qty: number; unitPrice?: number; lineTotal: number }>
      }
      /** Optional personal message from the sender, included in the email body. */
      message?: string
      channels: ('email' | 'whatsapp')[]
    }

    if (!payload.quoteId || !payload.quote) {
      throw Object.assign(new Error('Quote data is required'), { status: 400 })
    }

    const results: Record<string, { success: boolean; error?: string }> = {}

    // Send via Email — the quotation PDF travels as an attachment (Odoo:
    // Send by Email attaches the quotation document).
    if (payload.channels.includes('email')) {
      const isDev = process.env.NODE_ENV !== 'production'
      const emailContent = generateQuoteEmail({ ...payload.quote, message: payload.message })
      let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = []
      try {
        const pdf = await generateQuotePdfBuffer(payload.quote)
        attachments = [{
          filename: `${payload.quote.ref.replace(/[/\\]/g, '-')}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        }]
      } catch (error) {
        // A PDF failure must not block the quotation email itself.
        console.error('Quote PDF generation failed:', error)
      }

      if (isDev) {
        logEmailForDev({
          to: payload.quote.contactEmail,
          ...emailContent,
          attachments,
        })
        results.email = { success: true }
      } else {
        const emailResult = await sendEmail({
          to: payload.quote.contactEmail,
          mailbox: 'sales',
          // From is resolved Contabo-safe by pickMailbox; sales@ goes on Reply-To.
          replyTo: process.env.SALES_EMAIL || undefined,
          ...emailContent,
          attachments,
        })
        results.email = emailResult
      }
    }

    // Send via WhatsApp
    if (payload.channels.includes('whatsapp')) {
      const isDev = process.env.NODE_ENV !== 'production'

      if (isDev) {
        logWhatsAppForDev({
          to: payload.quote.contactPhone,
          type: 'text',
          text: `Quote ${payload.quote.ref} ready...`,
        })
        results.whatsapp = { success: true }
      } else {
        const whatsappResult = await sendQuoteViaWhatsApp({
          ref: payload.quote.ref,
          companyName: payload.quote.companyName,
          contactPersonName: payload.quote.contactPersonName,
          contactPhone: payload.quote.contactPhone,
          total: payload.quote.total,
          validUntil: payload.quote.validUntil,
          ownerName: payload.quote.ownerName,
        })
        results.whatsapp = whatsappResult
      }
    }

    // Check if any channel succeeded
    const anySuccess = Object.values(results).some(r => r.success)

    if (!anySuccess) {
      const firstError = Object.values(results).map(r => r.error).find(Boolean)
      return NextResponse.json({
        success: false,
        message: firstError || 'Failed to send quote via any channel',
        results,
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Quote sent successfully',
      results,
      sentBy: session.user.username,
    })
  })
}
