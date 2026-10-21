import 'server-only'

import { resolveEmailProvider, sendEmail, type MailboxProfile } from '@/lib/integrations/email'
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp'
import { sendNotification } from '@/lib/integrations/notifications'
import { sendWebPush } from './web-push'
import { brandedEmailHtml, textToEmailHtml } from '@/lib/email/branded-layout'
import { resolveSmsProvider } from './sms-provider'
import type { NotificationChannel, ProviderSendResult } from './types'

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

const MAILBOX_LABEL: Record<MailboxProfile, string> = {
  accounts: 'Accounts',
  hr: 'Human resources',
  sales: 'Sales',
  default: 'Deed ERP',
}

/** A system notification as an email: the branded layout with the alert as a tidy list. */
export function genericHtml(title: string, body: string, actionUrl?: string | null, actions?: EmailAction[], eventType?: string) {
  const buttons = actions?.length ? actions : actionUrl ? [{ label: 'Open in Deed ERP', url: actionUrl }] : []
  return brandedEmailHtml({
    title,
    eyebrow: eventType ? (MAILBOX_LABEL[mailboxForEvent(eventType)] ?? 'Deed ERP') : 'Deed ERP',
    preheader: body.split(/\r?\n/).map(line => line.replace(/^\s*[•\-*]\s+/, '').trim()).filter(Boolean).slice(0, 2).join(' · ') || title,
    bodyHtml: textToEmailHtml(body),
    actions: buttons,
    footnote: 'Sent automatically by Deed ERP because of your role. Reply to this email if something looks wrong.',
  })
}

async function emailAttachmentsFor(metadata: Record<string, unknown>) {
  const spec = metadata.emailAttachment as { kind?: string } | undefined
  if (spec?.kind !== 'payment_receipt' || typeof metadata.invoiceId !== 'string' || typeof metadata.paymentId !== 'string') return []
  try {
    const { paymentReceiptAttachment } = await import('@/lib/integrations/document-pdf.server')
    const pdf = await paymentReceiptAttachment({
      invoiceId: metadata.invoiceId,
      paymentId: metadata.paymentId,
      amount: Number(metadata.amount) || 0,
      paymentMethod: typeof metadata.paymentMethod === 'string' ? metadata.paymentMethod : null,
      reference: typeof metadata.reference === 'string' ? metadata.reference : null,
      paidAt: typeof metadata.paidAt === 'string' ? metadata.paidAt : null,
    })
    return pdf ? [pdf] : []
  } catch (err) {
    // The email still goes; only the PDF is missing.
    console.error('[notifications] receipt PDF failed', err)
    return []
  }
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
    const html = String(metadata.emailHtml || genericHtml(input.title, input.body, input.actionUrl, actions, input.eventType))
    // A document the email stands for (a payment receipt) is attached as a PDF.
    const attachments = await emailAttachmentsFor(metadata)
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
      ...(attachments.length ? { attachments } : {}),
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
