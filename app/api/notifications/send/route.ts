import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { sendNotification, sendRepairNotification, sendQuoteNotification, sendProcurementNotification } from '@/lib/integrations/notifications'
import { buildRepairLinkMessage, sendMultiChannelMessage, type MessageChannel } from '@/lib/integrations/messaging'

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

/**
 * POST /api/notifications/send
 * Send notification via Email, WhatsApp, or SMS.
 * Requires either a valid user session OR the x-internal-secret header.
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const callerSecret   = request.headers.get('x-internal-secret')

  const isInternalCall = internalSecret && callerSecret === internalSecret
  if (!isInternalCall) {
    const session = await getServerSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await request.json()
    const { type, ...params } = body
    const requestedChannels: MessageChannel[] = Array.isArray(params.channels)
      ? params.channels
      : (params.channel === 'email' ? ['email'] : [])

    let result

    switch (type) {
      case 'repair':
        if (requestedChannels.includes('email')) {
          const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke').replace(/\/$/, '')
          const trackingUrl = params.trackingUrl || params.repairUrl || `${appBaseUrl}/portal/repair/${encodeURIComponent(params.repairRef)}`
          result = await sendMultiChannelMessage({
            purpose: 'repair_link',
            recipient: { name: params.customerName, email: params.customerEmail, phone: params.customerPhone },
            channels: requestedChannels,
            mailbox: 'sales',
            content: buildRepairLinkMessage({
              customerName: params.customerName,
              repairRef: params.repairRef,
              deviceName: params.deviceName,
              trackingUrl,
              message: params.message,
            }),
            metadata: { repairRef: params.repairRef, type: 'repair' },
          })
        } else {
          result = await sendRepairNotification(
            params.customerName,
            params.customerPhone,
            params.repairRef,
            params.deviceName,
            params.message,
            params.options
          )
        }
        break

      case 'quote':
        if (requestedChannels.includes('email')) {
          const companyName = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
          const quoteTotal = Number(params.quoteTotal || 0).toLocaleString()
          const quoteUrl = params.quoteUrl || ''
          const safeCompanyName = escapeHtml(companyName)
          const safeCustomerName = escapeHtml(params.customerName)
          const safeRepairRef = escapeHtml(params.repairRef)
          const safeDeviceName = escapeHtml(params.deviceName)
          const safeQuoteTotal = escapeHtml(quoteTotal)
          const safeQuoteUrl = escapeHtml(quoteUrl)
          const subject = `Repair quotation ${params.repairRef} from ${companyName}`
          const text = `Hi ${params.customerName},\n\nYour repair quotation is ready.\n\nRepair: ${params.repairRef}\nDevice: ${params.deviceName}\nTotal: KES ${quoteTotal} (incl. VAT)\n${quoteUrl ? `\nView and accept online: ${quoteUrl}\n` : ''}\nBest regards,\n${companyName}`
          result = await sendMultiChannelMessage({
            purpose: 'repair_quote',
            recipient: { name: params.customerName, email: params.customerEmail, phone: params.customerPhone },
            channels: requestedChannels,
            mailbox: 'sales',
            content: {
              subject,
              text,
              smsText: `Hi ${params.customerName}, quote for repair ${params.repairRef}: KES ${quoteTotal}. ${quoteUrl || ''} - ${companyName}`,
              whatsappText: text,
              html: `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f8fafc;margin:0;padding:24px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;"><div style="background:#1B2762;color:#fff;padding:24px;"><h1 style="margin:0;font-size:22px;">${safeCompanyName}</h1><p style="margin:4px 0 0;opacity:.85;">Repair Quotation</p></div><div style="padding:28px;"><p>Hi ${safeCustomerName},</p><p>Your repair quotation is ready.</p><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:18px 0;"><p><strong>Repair:</strong> ${safeRepairRef}</p><p><strong>Device:</strong> ${safeDeviceName}</p><p><strong>Total:</strong> KES ${safeQuoteTotal} (incl. VAT)</p></div>${quoteUrl ? `<p><a href="${safeQuoteUrl}" style="display:inline-block;background:#1B2762;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">View and Accept Quote</a></p>` : ''}<p>Best regards,<br><strong>${safeCompanyName}</strong></p></div></div></body></html>`,
            },
            metadata: { repairRef: params.repairRef, type: 'quote' },
          })
        } else {
          result = await sendQuoteNotification(
            params.customerName,
            params.customerPhone,
            params.repairRef,
            params.deviceName,
            params.quoteTotal,
            params.quoteUrl
          )
        }
        break

      case 'procurement':
        result = await sendProcurementNotification(
          params.repairRef,
          params.technicianName,
          params.items,
          params.urgency,
          params.notes
        )
        break

      case 'general':
        if (requestedChannels.includes('email')) {
          const subject = params.subject || 'Message from Deed Technologies'
          const text = String(params.message || '')
          result = await sendMultiChannelMessage({
            purpose: 'general',
            recipient: { name: params.name, email: params.email || params.to, phone: params.phone },
            channels: requestedChannels,
            mailbox: params.mailbox || 'default',
            content: {
              subject,
              text,
              smsText: text,
              whatsappText: text,
              html: `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;"><p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p></body></html>`,
            },
            metadata: { type: 'general' },
          })
        } else {
          result = await sendNotification({
            to: params.to,
            message: params.message,
            priority: params.priority,
            channel: params.channel,
          })
        }
        break

      default:
        return NextResponse.json(
          { error: 'Invalid notification type' },
          { status: 400 }
        )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Notification API error:', error)
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    )
  }
}
