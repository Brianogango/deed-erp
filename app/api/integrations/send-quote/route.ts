import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail, generateQuoteEmail, logEmailForDev } from '@/lib/integrations/email'
import { sendQuoteViaWhatsApp, logWhatsAppForDev } from '@/lib/integrations/whatsapp'

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
        total: number
        validUntil: string
        ownerName: string
        lines: Array<{ productName: string; qty: number; lineTotal: number }>
      }
      channels: ('email' | 'whatsapp')[]
    }

    if (!payload.quoteId || !payload.quote) {
      throw Object.assign(new Error('Quote data is required'), { status: 400 })
    }

    const results: Record<string, { success: boolean; error?: string }> = {}

    // Send via Email
    if (payload.channels.includes('email')) {
      const isDev = process.env.NODE_ENV !== 'production'

      if (isDev) {
        const emailContent = generateQuoteEmail(payload.quote)
        logEmailForDev({
          to: payload.quote.contactEmail,
          ...emailContent,
        })
        results.email = { success: true }
      } else {
        const emailContent = generateQuoteEmail(payload.quote)
        const emailResult = await sendEmail({
          to: payload.quote.contactEmail,
          ...emailContent,
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
      return NextResponse.json({
        success: false,
        message: 'Failed to send quote via any channel',
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
