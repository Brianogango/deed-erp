import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { sendEmail } from '@/lib/integrations/email'

/**
 * POST /api/invoices/[id]/send
 *
 * Sends an invoice to the client using the **accounts** mailbox (accounts@deed.co.ke).
 *
 * Body (all optional — sensible defaults are inferred from the invoice / client):
 * {
 *   to?: string         // override recipient (otherwise client.email)
 *   cc?: string[]
 *   subject?: string
 *   message?: string    // free-text message inserted above the invoice summary
 *   pdfBase64?: string  // optional pre-rendered PDF generated client-side
 *   pdfFilename?: string
 * }
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()

    let body: any = {}
    try { body = await request.json() } catch {}

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { client: true, items: true },
    })
    if (!invoice) {
      throw Object.assign(new Error('Invoice not found'), { status: 404 })
    }

    const recipient: string | undefined = body.to || invoice.client.email || undefined
    if (!recipient) {
      throw Object.assign(new Error('No recipient email — provide "to" or set the client email'), { status: 400 })
    }

    const companyName = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
    const subject: string = body.subject || `Invoice ${invoice.invoiceNumber} from ${companyName}`
    const greeting = `Hello ${invoice.client.name || invoice.client.companyName || 'Customer'}`

    const total = Number(invoice.totalAmount).toLocaleString()
    const due = invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : 'On receipt'

    const html = `
<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#333;">
  <div style="max-width:640px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
    <div style="background:#1B2762;color:#fff;padding:18px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;">${companyName}</h1>
      <p style="margin:4px 0 0;opacity:.85;">Accounts Department</p>
    </div>
    <div style="padding:18px 0;">
      <p>${greeting},</p>
      ${body.message ? `<p>${String(body.message).replace(/\n/g, '<br/>')}</p>` : '<p>Please find your invoice details below. The PDF copy is attached.</p>'}
      <div style="background:#f9fafb;padding:14px;border-radius:8px;margin:14px 0;">
        <p style="margin:4px 0;"><strong>Invoice:</strong> ${invoice.invoiceNumber}</p>
        <p style="margin:4px 0;"><strong>Amount due:</strong> KES ${total}</p>
        <p style="margin:4px 0;"><strong>Due date:</strong> ${due}</p>
      </div>
      <p>For any questions about this invoice, reply to this email or contact <a href="mailto:${process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke'}">${process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke'}</a>.</p>
      <p style="margin-top:24px;">Best regards,<br/><strong>Accounts Department</strong><br/>${companyName}</p>
    </div>
  </div>
</body></html>`

    const text = `${greeting},

${body.message ? body.message + '\n\n' : 'Please find your invoice details below.\n\n'}Invoice:    ${invoice.invoiceNumber}
Amount due: KES ${total}
Due date:   ${due}

For any questions, reply to this email or contact ${process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke'}.

Best regards,
Accounts Department
${companyName}`

    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = []
    if (typeof body.pdfBase64 === 'string' && body.pdfBase64.length > 0) {
      attachments.push({
        filename: body.pdfFilename || `${invoice.invoiceNumber}.pdf`,
        content: Buffer.from(body.pdfBase64, 'base64'),
        contentType: 'application/pdf',
      })
    }

    const result = await sendEmail({
      to: recipient,
      cc: body.cc,
      mailbox: 'accounts',
      from: process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke',
      subject,
      html,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    })

    if (!result.success) {
      console.error('[invoices] Send failed', { invoiceId: invoice.id, to: recipient, error: result.error })
      return NextResponse.json({ success: false, error: result.error, to: recipient }, { status: 502 })
    }

    console.log('[invoices] Sent', { invoiceId: invoice.id, to: recipient, messageId: result.messageId, sentBy: session.user.username })

    // Mark as 'invoiced' (i.e. issued) if it was draft
    if (invoice.status === 'draft') {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'invoiced' } })
    }

    return NextResponse.json({
      success: true,
      to: recipient,
      messageId: result.messageId,
      invoiceId: invoice.id,
      sentBy: session.user.username,
    })
  })
}
