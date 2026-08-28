import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { generateRfqEmail, sendEmail } from '@/lib/integrations/email'
import { appendDocumentEmailSend, parseEmailList } from '@/lib/document-email-sends'

/**
 * POST /api/integrations/send-rfq
 * Server-send an RFQ to the vendor (uses default/info mailbox).
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
      to?: string
      cc?: string[]
      message?: string
      rfq: {
        ref: string
        vendorName: string
        companyName?: string
        expectedDate?: string
        notes?: string
        lines: Array<{ productName: string; qty: number; unitPrice: number; subtotal: number }>
        subtotal: number
        taxTotal: number
        total: number
      }
    }

    const to = String(payload.to || '').trim()
    if (!to || !to.includes('@')) {
      throw Object.assign(new Error('Vendor email is required'), { status: 400 })
    }
    if (!payload.rfq?.ref || !Array.isArray(payload.rfq.lines) || payload.rfq.lines.length === 0) {
      throw Object.assign(new Error('RFQ data with at least one line is required'), { status: 400 })
    }

    const content = generateRfqEmail({
      ...payload.rfq,
      companyName: payload.rfq.companyName || process.env.PDF_COMPANY_NAME || 'Deed Technologies',
      senderName: session.user?.name,
      message: payload.message,
    })

    const result = await sendEmail({
      to,
      cc: payload.cc,
      mailbox: 'default',
      from: process.env.EMAIL_FROM || process.env.SMTP_USER || undefined,
      ...content,
    })

    const historyBase = {
      documentType: 'rfq' as const,
      documentId: payload.rfq.ref,
      documentRef: payload.rfq.ref,
      to,
      cc: parseEmailList(payload.cc),
      subject: content.subject,
      channel: 'email' as const,
      kind: 'initial' as const,
      sentById: session.user.id,
      sentByName: session.user.name,
    }

    if (!result.success) {
      await appendDocumentEmailSend({
        ...historyBase,
        status: 'failed',
        error: result.error || 'Failed to send RFQ email',
      }).catch(error => console.error('[send-rfq] failed to record send history', error))
      throw Object.assign(new Error(result.error || 'Failed to send RFQ email'), { status: 502 })
    }

    await appendDocumentEmailSend({
      ...historyBase,
      status: 'success',
      messageId: result.messageId,
    }).catch(error => console.error('[send-rfq] failed to record send history', error))

    return NextResponse.json({ success: true, messageId: result.messageId })
  })
}
