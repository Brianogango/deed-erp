import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail, generateQuoteEmail, logEmailForDev } from '@/lib/integrations/email'
import { sendQuoteViaWhatsApp, logWhatsAppForDev } from '@/lib/integrations/whatsapp'
import { generateQuotePdfBuffer } from '@/lib/integrations/quote-pdf'
import { appendDocumentEmailSend, parseEmailList } from '@/lib/document-email-sends'
import { generateQuoteToken } from '@/lib/quote-token'
import { loadAppState } from '@/lib/server-store'

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
      /** First send vs revised quotation email copy. */
      kind?: 'initial' | 'update'
      /** Extra recipients (Cc). */
      cc?: string | string[]
      channels: ('email' | 'whatsapp')[]
    }

    if (!payload.quoteId || !payload.quote) {
      throw Object.assign(new Error('Quote data is required'), { status: 400 })
    }

    const cc = parseEmailList(payload.cc)
    const kind = payload.kind === 'update' ? 'update' as const : 'initial' as const
    const results: Record<string, { success: boolean; error?: string; messageId?: string }> = {}
    let emailSendRecord: Awaited<ReturnType<typeof appendDocumentEmailSend>> | null = null

    // Send via Email — the quotation PDF travels as an attachment (Odoo:
    // Send by Email attaches the quotation document).
    if (payload.channels.includes('email')) {
      const isDev = process.env.NODE_ENV !== 'production'
      // "Online Acceptance" setting: quoteId works for both a CRM Quote and
      // a Sales module SaleOrder — generateQuoteToken/the portal route are
      // both keyed purely on the id string, not the entity type, so the
      // SAME link works for either without this route needing to know which.
      const settings = await loadAppState(['deed_systemSettings']).catch(() => ({}))
      const onlineAcceptanceEnabled = Boolean((settings as any)?.deed_systemSettings?.salesOnlineAcceptance)
      const portalLink = onlineAcceptanceEnabled
        ? `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/portal/quotes/${payload.quoteId}?token=${encodeURIComponent(generateQuoteToken(payload.quoteId))}`
        : undefined

      const emailContent = generateQuoteEmail({
        ...payload.quote,
        message: payload.message,
        kind,
        pdfAttached: true,
        portalLink,
      })

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

      // If PDF attach failed, regenerate copy without the attachment claim.
      const finalEmailContent = attachments.length > 0
        ? emailContent
        : generateQuoteEmail({
            ...payload.quote,
            message: payload.message,
            kind,
            pdfAttached: false,
            portalLink,
          })

      if (isDev) {
        logEmailForDev({
          to: payload.quote.contactEmail,
          cc,
          ...finalEmailContent,
          attachments,
        })
        results.email = { success: true, messageId: `dev-${Date.now()}` }
      } else {
        const emailResult = await sendEmail({
          to: payload.quote.contactEmail,
          cc: cc.length ? cc : undefined,
          mailbox: 'sales',
          // From is resolved Contabo-safe by pickMailbox; sales@ goes on Reply-To.
          replyTo: process.env.SALES_EMAIL || undefined,
          ...finalEmailContent,
          attachments,
        })
        results.email = emailResult
      }

      emailSendRecord = await appendDocumentEmailSend({
        documentType: 'quote',
        documentId: payload.quoteId,
        documentRef: payload.quote.ref,
        to: payload.quote.contactEmail,
        cc,
        subject: finalEmailContent.subject,
        body: finalEmailContent.text,
        status: results.email.success ? 'success' : 'failed',
        error: results.email.error,
        messageId: results.email.messageId,
        channel: 'email',
        kind,
        sentById: session.user.id,
        sentByName: session.user.name || session.user.username,
      })
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
          kind,
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
        emailSend: emailSendRecord,
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Quote sent successfully',
      results,
      emailSend: emailSendRecord,
      sentBy: session.user.username,
      cc,
    })
  })
}
