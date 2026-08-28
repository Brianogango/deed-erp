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
  errorCode?: string
  httpStatus?: number
}

type SmsQueueItem<T> = {
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

type SmsLimiterState = {
  active: number
  nextAllowedAt: number
  queue: Array<SmsQueueItem<any>>
  pumping: boolean
}

const smsLimiter = (() => {
  const root = globalThis as unknown as { __deedSmsLimiter?: SmsLimiterState }
  if (!root.__deedSmsLimiter) {
    root.__deedSmsLimiter = { active: 0, nextAllowedAt: 0, queue: [], pumping: false }
  }
  return root.__deedSmsLimiter
})()

const notifEnvNumber = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function pumpSmsQueue() {
  if (smsLimiter.pumping) return
  if (smsLimiter.queue.length === 0) return

  const maxConcurrent = notifEnvNumber('SMS_MAX_CONCURRENT', 2, 1, 20)
  if (smsLimiter.active >= maxConcurrent) return

  const perSecond = notifEnvNumber('SMS_MAX_PER_SECOND', 1, 1, 50)
  const waitMs = Math.max(0, smsLimiter.nextAllowedAt - Date.now())
  if (waitMs > 0) {
    smsLimiter.pumping = true
    setTimeout(() => {
      smsLimiter.pumping = false
      pumpSmsQueue()
    }, waitMs)
    return
  }

  const item = smsLimiter.queue.shift()!
  smsLimiter.active += 1
  smsLimiter.nextAllowedAt = Date.now() + Math.ceil(1000 / perSecond)

  // Schedule the next item according to the global start-rate while allowing
  // up to SMS_MAX_CONCURRENT requests to remain in flight.
  smsLimiter.pumping = true
  setTimeout(() => {
    smsLimiter.pumping = false
    pumpSmsQueue()
  }, Math.ceil(1000 / perSecond))

  void item.run()
    .then(item.resolve, item.reject)
    .finally(() => {
      smsLimiter.active -= 1
      pumpSmsQueue()
    })
}

function withSmsRateLimit<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    smsLimiter.queue.push({ run, resolve, reject })
    pumpSmsQueue()
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      output[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return output
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
        errorCode: whatsappResult.errorCode,
        httpStatus: whatsappResult.httpStatus,
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

  return withSmsRateLimit(async () => {
    try {
      const twilio = await import('twilio')
      const client = twilio.default(accountSid, authToken, {
        timeout: notifEnvNumber('TWILIO_HTTP_TIMEOUT_MS', 10_000, 1_000, 120_000),
      })

      const appBase = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
      const result = await client.messages.create({
        body: message,
        from: fromNumber,
        to,
        ...(appBase ? { statusCallback: `${appBase}/api/webhooks/notifications/twilio` } : {}),
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
        errorCode: error?.code != null ? String(error.code) : undefined,
        httpStatus: error?.status != null ? Number(error.status) : undefined,
      }
    }
  })
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
  const concurrency = notifEnvNumber('NOTIFICATION_BATCH_CONCURRENCY', 4, 1, 20)
  return mapWithConcurrency(recipients, concurrency, async ({ phone, message }) => {
    const result = await sendNotification({
      to: formatPhoneNumber(phone),
      message,
      ...options,
    })
    return { ...result, phone }
  })
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
