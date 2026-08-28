import 'server-only'

import { resolveEmailProvider, sendEmail, type MailboxProfile } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'
import { sendNotification } from '@/lib/integrations/notifications'
import { sendWebPush } from './web-push'
import type { NotificationChannel, ProviderSendResult } from './types'

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function mailboxForEvent(eventType: string): MailboxProfile {
  if (eventType.startsWith('hr.')) return 'hr'
  if (eventType.startsWith('finance.')) return 'accounts'
  if (eventType.startsWith('sales.') || eventType.startsWith('crm.')) return 'sales'
  return 'default'
}

function genericHtml(title: string, body: string, actionUrl?: string | null) {
  const brand = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
    <div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#1B2762;color:#fff;padding:22px 26px"><strong style="font-size:20px">${escapeHtml(brand)}</strong></div>
      <div style="padding:26px">
        <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h2>
        <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(body)}</p>
        ${actionUrl ? `<p style="margin-top:20px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#00AEEF;color:#fff;text-decoration:none;padding:11px 16px;border-radius:8px;font-weight:700">Open in Deed ERP</a></p>` : ''}
      </div>
    </div>
  </body></html>`
}

export type ProviderDeliveryInput = {
  channel: NotificationChannel
  eventType: string
  title: string
  body: string
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
    const html = String(metadata.emailHtml || genericHtml(input.title, input.body, input.actionUrl))
    const result = await sendEmail({
      to: input.destination,
      mailbox: mailboxForEvent(input.eventType),
      subject,
      html,
      text: String(metadata.emailText || text),
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
    }
  }

  if (input.channel === 'sms') {
    if (!input.destination) return { success: false, provider: 'twilio', error: 'Missing SMS destination', errorCode: 'missing_destination' }
    const result = await sendNotification({
      to: input.destination,
      channel: 'sms',
      message: String(metadata.smsText || text).slice(0, 480),
    })
    return {
      success: result.success,
      provider: 'twilio',
      messageId: result.messageId,
      error: result.error,
    }
  }

  if (input.channel === 'push') {
    if (!input.endpoint) return { success: false, provider: 'web_push', error: 'Missing push subscription', errorCode: 'missing_endpoint' }
    return sendWebPush(input.endpoint, {
      title: input.title,
      body: input.body,
      url: input.actionUrl || '/',
      eventType: input.eventType,
    })
  }

  return { success: false, provider: input.channel, error: 'Unsupported channel', errorCode: 'unsupported_channel' }
}
