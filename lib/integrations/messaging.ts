import { sendEmail, type EmailMessage, type EmailResult, type MailboxProfile } from './email'
import { sendNotification, formatPhoneNumber, type NotificationResult } from './notifications'

export type MessageChannel = 'email' | 'whatsapp' | 'sms'
export type MessagePurpose = 'invoice' | 'repair_link' | 'repair_quote' | 'credentials' | 'general' | 'payment_receipt'

export interface MessagingRecipient {
  name?: string
  email?: string | null
  phone?: string | null
}

export interface MessagingContent {
  subject: string
  html: string
  text: string
  smsText?: string
  whatsappText?: string
}

export interface SendMessageInput {
  purpose: MessagePurpose
  recipient: MessagingRecipient
  channels: MessageChannel[]
  content: MessagingContent
  mailbox?: MailboxProfile
  from?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string[]
  attachments?: EmailMessage['attachments']
  metadata?: Record<string, unknown>
}

export interface ChannelSendResult {
  success: boolean
  channel: MessageChannel
  messageId?: string
  error?: string
}

export interface MultiChannelSendResult {
  success: boolean
  results: Record<MessageChannel, ChannelSendResult>
}

const orderedUniqueChannels = (channels: MessageChannel[]): MessageChannel[] => (
  Array.from(new Set(channels.length > 0 ? channels : ['email']))
)

const resultFromEmail = (result: EmailResult): Omit<ChannelSendResult, 'channel'> => ({
  success: result.success,
  messageId: result.messageId,
  error: result.error,
})

const resultFromNotification = (result: NotificationResult): Omit<ChannelSendResult, 'channel'> => ({
  success: result.success,
  messageId: result.messageId,
  error: result.error,
})

const logMessagingEvent = (input: SendMessageInput, results: Record<MessageChannel, ChannelSendResult>) => {
  const summary = Object.values(results).map(result => ({
    channel: result.channel,
    success: result.success,
    messageId: result.messageId,
    error: result.error,
  }))

  // Centralised logging point. This is intentionally lightweight for now so it
  // works without a database migration; it can later be replaced with a Prisma
  // MessageLog model without changing callers.
  console.log('[messaging] send result', {
    purpose: input.purpose,
    recipient: {
      name: input.recipient.name,
      email: input.recipient.email,
      phone: input.recipient.phone,
    },
    metadata: input.metadata,
    results: summary,
  })
}

export const sendMultiChannelMessage = async (input: SendMessageInput): Promise<MultiChannelSendResult> => {
  const results = {} as Record<MessageChannel, ChannelSendResult>

  for (const channel of orderedUniqueChannels(input.channels)) {
    if (channel === 'email') {
      if (!input.recipient.email) {
        results.email = { channel, success: false, error: 'Recipient email is required' }
        continue
      }

      const emailResult = await sendEmail({
        to: input.recipient.email,
        cc: input.cc,
        bcc: input.bcc,
        mailbox: input.mailbox,
        from: input.from,
        replyTo: input.replyTo,
        subject: input.content.subject,
        html: input.content.html,
        text: input.content.text,
        attachments: input.attachments,
      })
      results.email = { channel, ...resultFromEmail(emailResult) }
      continue
    }

    if (channel === 'whatsapp' || channel === 'sms') {
      if (!input.recipient.phone) {
        results[channel] = { channel, success: false, error: 'Recipient phone is required' }
        continue
      }

      const phoneResult = await sendNotification({
        to: formatPhoneNumber(input.recipient.phone),
        channel,
        message: channel === 'whatsapp'
          ? (input.content.whatsappText || input.content.smsText || input.content.text)
          : (input.content.smsText || input.content.text),
      })
      results[channel] = { channel, ...resultFromNotification(phoneResult) }
      continue
    }
  }

  logMessagingEvent(input, results)

  return {
    success: Object.values(results).some(result => result.success),
    results,
  }
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

export const buildRepairLinkMessage = (params: {
  customerName: string
  repairRef: string
  deviceName?: string
  trackingUrl: string
  message?: string
}): MessagingContent => {
  const greeting = params.customerName || 'Customer'
  const subject = `Repair ${params.repairRef} tracking link`
  const intro = params.message || 'You can track your repair progress using the secure link below.'
  const deviceLine = params.deviceName ? `Device: ${params.deviceName}\n` : ''
  const text = `Hi ${greeting},\n\n${intro}\n\nRepair: ${params.repairRef}\n${deviceLine}Track progress: ${params.trackingUrl}\n\nBest regards,\nDeed Technologies`

  return {
    subject,
    text,
    smsText: `Hi ${greeting}, track repair ${params.repairRef}: ${params.trackingUrl} - Deed Technologies`,
    whatsappText: text,
    html: `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#1B2762;color:#fff;padding:24px;"><h1 style="margin:0;font-size:22px;">Deed Technologies</h1><p style="margin:4px 0 0;opacity:.85;">Repair Tracking</p></div>
        <div style="padding:28px;">
          <p>Hi ${escapeHtml(greeting)},</p>
          <p>${escapeHtml(intro)}</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;">
            <p style="margin:4px 0;"><strong>Repair:</strong> ${escapeHtml(params.repairRef)}</p>
            ${params.deviceName ? `<p style="margin:4px 0;"><strong>Device:</strong> ${escapeHtml(params.deviceName)}</p>` : ''}
          </div>
          <p><a href="${escapeHtml(params.trackingUrl)}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Track Repair</a></p>
          <p style="font-size:13px;color:#64748b;">If the button does not open, copy this link into your browser:<br>${escapeHtml(params.trackingUrl)}</p>
          <p>Best regards,<br><strong>Deed Technologies</strong></p>
        </div>
      </div>
    </body></html>`,
  }
}

export const buildCredentialMessage = (params: {
  name: string
  username: string
  temporaryPassword: string
  mode: 'welcome' | 'reset'
  loginUrl?: string
}): MessagingContent => {
  const loginUrl = params.loginUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke'
  const subject = params.mode === 'welcome' ? 'Your Deed ERP account is ready' : 'Your Deed ERP credentials have been reset'
  const action = params.mode === 'welcome'
    ? 'Your Deed ERP account has been created.'
    : 'Your Deed ERP password has been reset by an administrator.'
  const text = `Hi ${params.name},\n\n${action}\n\nLogin: ${loginUrl}\nUsername: ${params.username}\nTemporary password: ${params.temporaryPassword}\n\nYou must change this password after signing in. If you were not expecting this message, contact HR immediately.\n\nBest regards,\nHR Department\nDeed Technologies`

  return {
    subject,
    text,
    smsText: `Deed ERP credentials for ${params.name}: username ${params.username}. Temporary password sent by email.`,
    whatsappText: text,
    html: `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#1B2762;color:#fff;padding:24px;"><h1 style="margin:0;font-size:22px;">Deed Technologies</h1><p style="margin:4px 0 0;opacity:.85;">ERP Account Access</p></div>
        <div style="padding:28px;">
          <p>Hi ${escapeHtml(params.name)},</p>
          <p>${escapeHtml(action)}</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;">
            <p style="margin:4px 0;"><strong>Username:</strong> <code>${escapeHtml(params.username)}</code></p>
            <p style="margin:4px 0;"><strong>Temporary password:</strong> <code>${escapeHtml(params.temporaryPassword)}</code></p>
          </div>
          <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Sign in to Deed ERP</a></p>
          <p style="font-size:13px;color:#64748b;">You must change this password after signing in. If you were not expecting this message, contact HR immediately.</p>
          <p>Best regards,<br><strong>HR Department</strong><br>Deed Technologies</p>
        </div>
      </div>
    </body></html>`,
  }
}
