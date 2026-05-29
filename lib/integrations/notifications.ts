// ─── Unified Notification Service ─────────────────────────────────────────────

/**
 * Unified notification service for SMS and WhatsApp
 * 
 * Features:
 * - WhatsApp as primary channel
 * - SMS as fallback
 * - Development mode logging
 * - Queue management
 * - Delivery status tracking
 */

import { sendWhatsAppMessage, WhatsAppResult } from './whatsapp'

export interface NotificationOptions {
  to: string              // Phone number with country code
  message: string         // Message text
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  channel?: 'auto' | 'whatsapp' | 'sms'  // Auto tries WhatsApp first, then SMS
}

export interface NotificationResult {
  success: boolean
  channel?: 'whatsapp' | 'sms'
  messageId?: string
  error?: string
}

/**
 * Send notification via WhatsApp or SMS
 * In production: Tries WhatsApp first, falls back to SMS
 * In development: Logs to console
 */
export const sendNotification = async (options: NotificationOptions): Promise<NotificationResult> => {
  const { to, message, priority = 'normal', channel = 'auto' } = options

  // Development mode: just log
  if (process.env.NODE_ENV !== 'production') {
    logNotificationForDev(to, message, priority)
    return {
      success: true,
      channel: 'whatsapp',
      messageId: `dev-${Date.now()}`,
    }
  }

  // Validate phone number format
  if (!to || !to.startsWith('+')) {
    return {
      success: false,
      error: 'Invalid phone number format. Must include country code (e.g., +254722000111)',
    }
  }

  // Try WhatsApp first (if auto or whatsapp)
  if (channel === 'auto' || channel === 'whatsapp') {
    const whatsappResult = await sendViaWhatsApp(to, message)
    if (whatsappResult.success) {
      return {
        success: true,
        channel: 'whatsapp',
        messageId: whatsappResult.messageId,
      }
    }

    // If WhatsApp only, return error
    if (channel === 'whatsapp') {
      return {
        success: false,
        error: whatsappResult.error || 'WhatsApp delivery failed',
      }
    }

    // Otherwise continue to SMS fallback
  }

  // Try SMS
  if (channel === 'auto' || channel === 'sms') {
    const smsResult = await sendViaSMS(to, message)
    if (smsResult.success) {
      return {
        success: true,
        channel: 'sms',
        messageId: smsResult.messageId,
      }
    }

    return {
      success: false,
      error: smsResult.error || 'SMS delivery failed',
    }
  }

  return {
    success: false,
    error: 'No valid notification channel specified',
  }
}

/**
 * Send via WhatsApp
 */
const sendViaWhatsApp = async (to: string, message: string): Promise<WhatsAppResult> => {
  try {
    return await sendWhatsAppMessage({
      to,
      type: 'text',
      text: message,
    })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'WhatsApp error',
    }
  }
}

/**
 * Send via SMS (Twilio)
 * Note: Only works on server-side (Node.js environment)
 */
const sendViaSMS = async (to: string, message: string): Promise<NotificationResult> => {
  // Check if running on server
  if (typeof window !== 'undefined') {
    return {
      success: false,
      error: 'SMS can only be sent from server-side',
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return {
      success: false,
      error: 'SMS not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.',
    }
  }

  try {
    // Dynamic import for server-side only
    const twilio = await import('twilio')
    const client = twilio.default(accountSid, authToken)

    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    })

    return {
      success: true,
      channel: 'sms',
      messageId: result.sid,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'SMS delivery failed',
    }
  }
}

/**
 * Format phone number to international format
 */
export const formatPhoneNumber = (phone: string): string => {
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')

  // If starts with 0, replace with +254 (Kenya)
  if (cleaned.startsWith('0')) {
    cleaned = '+254' + cleaned.slice(1)
  }

  // If starts with 254, add +
  if (cleaned.startsWith('254')) {
    cleaned = '+' + cleaned
  }

  // If doesn't start with +, assume Kenya
  if (!cleaned.startsWith('+')) {
    cleaned = '+254' + cleaned
  }

  return cleaned
}

/**
 * Batch send notifications (for multiple recipients)
 */
export const sendBatchNotifications = async (
  recipients: Array<{ phone: string; message: string }>,
  options?: { priority?: NotificationOptions['priority']; channel?: NotificationOptions['channel'] }
): Promise<Array<NotificationResult & { phone: string }>> => {
  const results = await Promise.all(
    recipients.map(async ({ phone, message }) => {
      const result = await sendNotification({
        to: formatPhoneNumber(phone),
        message,
        ...options,
      })
      return { ...result, phone }
    })
  )

  return results
}

/**
 * Send repair notification (helper for repair module)
 */
export const sendRepairNotification = async (
  customerName: string,
  customerPhone: string,
  repairRef: string,
  deviceName: string,
  message: string,
  options?: Omit<NotificationOptions, 'to' | 'message'>
): Promise<NotificationResult> => {
  const formattedPhone = formatPhoneNumber(customerPhone)
  
  const fullMessage = `Hi ${customerName},

${message}

Repair: ${repairRef}
Device: ${deviceName}

- Deed Technologies
www.deed.co.ke`

  return sendNotification({
    to: formattedPhone,
    message: fullMessage,
    ...options,
  })
}

/**
 * Send procurement notification to team
 */
export const sendProcurementNotification = async (
  repairRef: string,
  technicianName: string,
  items: Array<{ productName: string; qty: number; estimatedCost: number }>,
  urgency: string,
  notes?: string
): Promise<NotificationResult> => {
  const procurementTeamPhone = process.env.PROCUREMENT_TEAM_PHONE || '+254700000000'
  
  const itemsList = items.map(item => 
    `- ${item.productName} x${item.qty} (Est. KES ${item.estimatedCost.toLocaleString()})`
  ).join('\n')

  const total = items.reduce((sum, item) => sum + (item.qty * item.estimatedCost), 0)

  const message = `🔧 PARTS REQUEST - ${urgency.toUpperCase()}

Repair: ${repairRef}
Requested by: ${technicianName}

PARTS NEEDED:
${itemsList}

TOTAL ESTIMATE: KES ${total.toLocaleString()}

${notes ? `Notes: ${notes}` : ''}

Please process this request ASAP.

- Deed ERP`

  return sendNotification({
    to: procurementTeamPhone,
    message,
    priority: urgency as NotificationOptions['priority'],
  })
}

/**
 * Send quote notification
 */
export const sendQuoteNotification = async (
  customerName: string,
  customerPhone: string,
  repairRef: string,
  deviceName: string,
  quoteTotal: number,
  quoteUrl?: string
): Promise<NotificationResult> => {
  const formattedPhone = formatPhoneNumber(customerPhone)
  
  const message = `Hi ${customerName},

Your repair quotation is ready!

Repair: ${repairRef}
Device: ${deviceName}
Total: KES ${quoteTotal.toLocaleString()} (incl. VAT)

${quoteUrl ? `View & Accept Online:\n${quoteUrl}` : 'Please check your email for details.'}

Reply with "YES" to approve or "NO" to decline.

- Deed Technologies`

  return sendNotification({
    to: formattedPhone,
    message,
    priority: 'high',
  })
}

/**
 * Development Mode: Log notification
 */
const logNotificationForDev = (to: string, message: string, priority: string) => {
  if (process.env.NODE_ENV === 'production') return
  console.log('\n═══════════════════════════════════════════')
  console.log('📱 NOTIFICATION (Development Mode)')
  console.log('═══════════════════════════════════════════')
  console.log('To:', to)
  console.log('Priority:', priority)
  console.log('-------------------------------------------')
  console.log(message)
  console.log('═══════════════════════════════════════════\n')
}

/**
 * Get notification statistics
 */
export const getNotificationStats = () => {
  // TODO: Implement notification tracking
  return {
    sent: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
  }
}
