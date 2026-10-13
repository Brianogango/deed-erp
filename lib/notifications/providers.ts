import 'server-only'

import { resolveEmailProvider, sendEmail, type MailboxProfile } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'
import { sendNotification } from '@/lib/integrations/notifications'
import { sendWebPush } from './web-push'
import { resolveSmsProvider } from './sms-provider'
import type { NotificationChannel, ProviderSendResult } from './types'

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function mailboxForEvent(eventType: string): MailboxProfile {
  if (eventType.startsWith('hr.')) return 'hr'
  if (eventType.startsWith('finance.')) return 'accounts'
  if (eventType.startsWith('sales.') || eventType.startsWith('crm.')) return 'sales'
  return 'default'
}

/** Links in emails must be absolute: "/hr?tab=leave" is not clickable in a mail app. */
export function absoluteAppUrl(url: string | null | undefined): string | null {
  const value = String(url || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const base = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://erp.deed.co.ke').replace(/\/+$/, '')
  return `${base}${value.startsWith('/') ? '' : '/'}${value}`
}

export type EmailAction = { label: string; url: string; tone?: 'primary' | 'success' | 'danger' }

const BUTTON_COLORS: Record<NonNullable<EmailAction['tone']>, string> = { primary: '#00AEEF', success: '#15803D', danger: '#B91C1C' }

/** A table-cell button: Outlook ignores padding/background on a bare link. */
function emailButton(action: EmailAction) {
  const href = absoluteAppUrl(action.url)
  if (!href) return ''
  const color = BUTTON_COLORS[action.tone || 'primary']
  return `<td style="padding:0 10px 10px 0"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${color}" style="background:${color};border-radius:8px"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 20px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(action.label)}</a></td></tr></table></td>`
}

export function genericHtml(title: string, body: string, actionUrl?: string | null, actions?: EmailAction[]) {
  const brand = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
  const buttons = (actions?.length ? actions : actionUrl ? [{ label: 'Open in Deed ERP', url: actionUrl }] : [])
    .map(emailButton).filter(Boolean).join('')
  // One line per line: mail apps drop "white-space: pre-wrap".
  const bodyHtml = escapeHtml(body).split(/\r?\n/).join('<br>')
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
      <tr><td bgcolor="#1B2762" style="background:#1B2762;color:#ffffff;padding:20px 26px;border-radius:12px 12px 0 0"><strong style="font-size:20px">${escapeHtml(brand)}</strong></td></tr>
      <tr><td style="padding:26px">
        <h2 style="margin:0 0 14px;font-size:20px">${escapeHtml(title)}</h2>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7">${bodyHtml}</p>
        ${buttons ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>${buttons}</tr></table>` : ''}
      </td></tr>
    </table>
    </td></tr></table>
  </body></html>`
}

type ProviderDeliveryInput = {
  channel: NotificationChannel
  eventType: string
  title: string
  body: string
  /** Lets the ERP close this pop-up once the alert is read or dealt with. */
  eventId?: string | null
  actionUrl?: string | null
  destination?: string | null
  endpoint?: { endpoint: string; p256dh: string; authSecret: string } | null
  metadata?: Record<string, unknown>
}

export async function sendProviderDelivery(input: ProviderDeliveryInput): Promise<ProviderSendResult> {
  const metadata = input.metadata || {}
  const text = String(metadata[`${input.channel}Text`] || metadata.text || input.body)
  const subject = String(metadata.emailSubject || input.title)

  if (input.channel === 'in_app') {
    return { success: true, provider: 'in_app', acceptedAsDelivered: true }
  }

  if (input.channel === 'email') {
    if (!input.destination) return { success: false, provider: 'email', error: 'Missing email destination', errorCode: 'missing_destination' }
    const actions = Array.isArray(metadata.emailActions)
      ? (metadata.emailActions as unknown[]).filter((a): a is EmailAction =>
          !!a && typeof (a as EmailAction).label === 'string' && typeof (a as EmailAction).url === 'string')
      : undefined
    const html = String(metadata.emailHtml || genericHtml(input.title, input.body, input.actionUrl, actions))
    const result = await sendEmail({
      to: input.destination,
      mailbox: mailboxForEvent(input.eventType),
      // e.g. a leave request: replies go straight to the employee's work email.
      ...(typeof metadata.emailReplyTo === 'string' && metadata.emailReplyTo.includes('@') ? { replyTo: metadata.emailReplyTo } : {}),
      // …and the inbox shows who it is from.
      ...(typeof metadata.emailSenderName === 'string' && metadata.emailSenderName.trim() ? { senderName: metadata.emailSenderName } : {}),
      // From their own work email when the mail server allows it (see sendEmail).
      ...(typeof metadata.emailSenderEmail === 'string' && metadata.emailSenderEmail.includes('@') ? { senderEmail: metadata.emailSenderEmail } : {}),
      subject,
      html,
      text: [String(metadata.emailText || text), absoluteAppUrl(input.actionUrl)].filter(Boolean).join('\n\n'),
    })
    return {
      success: result.success,
      provider: resolveEmailProvider(),
      messageId: result.messageId,
      error: result.error,
    }
  }

  if (input.channel === 'whatsapp') {
    if (!input.destination) return { success: false, provider: 'whatsapp', error: 'Missing WhatsApp destination', errorCode: 'missing_destination' }
    const result = await sendWhatsAppMessage({
      to: input.destination,
      type: 'text',
      text: String(metadata.whatsappText || text),
    })
    return {
      success: result.success,
      provider: 'whatsapp',
      messageId: result.messageId,
      error: result.error,
      errorCode: result.errorCode,
      response: result.httpStatus ? { httpStatus: result.httpStatus } : undefined,
    }
  }

  if (input.channel === 'sms') {
    const provider = resolveSmsProvider() || 'twilio'
    if (!input.destination) return { success: false, provider, error: 'Missing SMS destination', errorCode: 'missing_destination' }
    const result = await sendNotification({
      to: input.destination,
      channel: 'sms',
      message: String(metadata.smsText || text).slice(0, 480),
    })
    return {
      success: result.success,
      provider,
      messageId: result.messageId,
      error: result.error,
      errorCode: result.errorCode,
      response: result.httpStatus ? { httpStatus: result.httpStatus } : undefined,
    }
  }

  if (input.channel === 'push') {
    if (!input.endpoint) return { success: false, provider: 'web_push', error: 'Missing push subscription', errorCode: 'missing_endpoint' }
    return sendWebPush(input.endpoint, {
      title: input.title,
      body: input.body,
      url: input.actionUrl || '/',
      eventType: input.eventType,
      eventId: input.eventId || null,
    })
  }

  return { success: false, provider: input.channel, error: 'Unsupported channel', errorCode: 'unsupported_channel' }
}
