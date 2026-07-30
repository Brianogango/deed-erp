import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { getEmailConfigStatus, sendEmail, type MailboxProfile } from '@/lib/integrations/email'

/**
 * POST /api/integrations/test-email
 * Body: { to: string, mailbox?: 'default' | 'hr' | 'sales' | 'accounts' }
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'admin_officer'])
    let body: { to?: string; mailbox?: MailboxProfile } = {}
    try { body = await request.json() } catch { /* empty */ }

    const to = String(body.to || '').trim()
    if (!to || !to.includes('@')) {
      throw Object.assign(new Error('Provide a valid "to" email address'), { status: 400 })
    }

    const mailbox = body.mailbox || 'default'
    const status = getEmailConfigStatus()
    if (status.missing.length > 0 && process.env.NODE_ENV === 'production') {
      throw Object.assign(
        new Error(`Email is not configured. Missing: ${status.missing.join(', ')}`),
        { status: 503 },
      )
    }

    const result = await sendEmail({
      to,
      mailbox,
      subject: `Deed ERP test email (${mailbox})`,
      html: `<p>This is a test message from Deed ERP.</p>
             <p>Sent by <strong>${actor.name}</strong> via mailbox <code>${mailbox}</code>.</p>
             <p>Provider: ${status.provider}</p>`,
      text: `Deed ERP test email via ${mailbox}. Sent by ${actor.name}. Provider: ${status.provider}`,
    })

    if (!result.success) {
      throw Object.assign(new Error(result.error || 'Test email failed'), { status: 502 })
    }

    return NextResponse.json({ success: true, messageId: result.messageId, status })
  })
}
