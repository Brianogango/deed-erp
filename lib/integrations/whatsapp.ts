// ─── WhatsApp Business API Integration ────────────────────────────────────────

/**
 * WhatsApp Business Integration
 * 
 * Setup:
 * 1. Create WhatsApp Business Account
 * 2. Get API credentials from Meta/Facebook
 * 3. Set environment variables:
 *    - WHATSAPP_PHONE_NUMBER_ID
 *    - WHATSAPP_ACCESS_TOKEN
 *    - WHATSAPP_BUSINESS_ACCOUNT_ID
 * 
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

export interface WhatsAppMessage {
  to: string  // Phone number with country code, e.g., +254722000111
  type: 'text' | 'template' | 'document' | 'image'
  text?: string
  templateName?: string
  templateParams?: string[]
  documentUrl?: string
  documentFilename?: string
  imageUrl?: string
  caption?: string
}

export interface WhatsAppResult {
  success: boolean
  messageId?: string
  error?: string
  errorCode?: string
  httpStatus?: number
}

const WHATSAPP_API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v18.0').trim()
const WHATSAPP_API_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`

type WhatsAppCircuitState = {
  consecutiveFailures: number
  openUntil: number
}

const whatsappCircuit = (() => {
  const root = globalThis as unknown as { __deedWhatsAppCircuit?: WhatsAppCircuitState }
  if (!root.__deedWhatsAppCircuit) {
    root.__deedWhatsAppCircuit = { consecutiveFailures: 0, openUntil: 0 }
  }
  return root.__deedWhatsAppCircuit
})()

const waEnvNumber = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name])
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function recordWhatsAppSuccess() {
  whatsappCircuit.consecutiveFailures = 0
  whatsappCircuit.openUntil = 0
}

function recordWhatsAppFailure(shouldTrip: boolean) {
  if (!shouldTrip) return
  whatsappCircuit.consecutiveFailures += 1
  const threshold = waEnvNumber('WHATSAPP_CIRCUIT_FAILURE_THRESHOLD', 5, 2, 50)
  if (whatsappCircuit.consecutiveFailures >= threshold) {
    const cooldown = waEnvNumber('WHATSAPP_CIRCUIT_COOLDOWN_MS', 60_000, 5_000, 15 * 60_000)
    whatsappCircuit.openUntil = Date.now() + cooldown
  }
}

/**
 * Send WhatsApp message via Cloud API
 */
export const sendWhatsAppMessage = async (message: WhatsAppMessage): Promise<WhatsAppResult> => {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      error: 'WhatsApp API not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.',
      errorCode: 'not_configured',
    }
  }

  if (whatsappCircuit.openUntil > Date.now()) {
    const retrySeconds = Math.ceil((whatsappCircuit.openUntil - Date.now()) / 1000)
    return {
      success: false,
      error: `WhatsApp provider circuit is open after repeated upstream failures. Retry in about ${retrySeconds}s.`,
      errorCode: 'circuit_open',
      httpStatus: 503,
    }
  }

  try {
    const payload: any = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: message.type,
    }

    switch (message.type) {
      case 'text':
        payload.text = { body: message.text }
        break
      case 'template':
        payload.template = {
          name: message.templateName,
          language: { code: 'en' },
          components: message.templateParams ? [
            {
              type: 'body',
              parameters: message.templateParams.map(param => ({ type: 'text', text: param })),
            },
          ] : [],
        }
        break
      case 'document':
        payload.document = {
          link: message.documentUrl,
          filename: message.documentFilename,
        }
        break
      case 'image':
        payload.image = {
          link: message.imageUrl,
          caption: message.caption,
        }
        break
    }

    const controller = new AbortController()
    const timeoutMs = waEnvNumber('WHATSAPP_HTTP_TIMEOUT_MS', 10_000, 1_000, 120_000)
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const code = String(data?.error?.code ?? response.status)
      const shouldTrip = response.status === 429 || response.status >= 500
      recordWhatsAppFailure(shouldTrip)
      return {
        success: false,
        error: data?.error?.message || `WhatsApp API returned HTTP ${response.status}`,
        errorCode: code,
        httpStatus: response.status,
      }
    }

    recordWhatsAppSuccess()
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
      httpStatus: response.status,
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    recordWhatsAppFailure(true)
    return {
      success: false,
      error: timedOut
        ? 'WhatsApp API request timed out'
        : error instanceof Error ? error.message : 'Unknown error',
      errorCode: timedOut ? 'timeout' : 'network_error',
      httpStatus: timedOut ? 504 : 503,
    }
  }
}

/**
 * Send Quote via WhatsApp
 */
export const sendQuoteViaWhatsApp = async (quote: {
  ref: string
  companyName: string
  contactPersonName: string
  contactPhone: string
  total: number
  validUntil: string
  ownerName?: string
  quoteUrl?: string
  kind?: 'initial' | 'update'
}): Promise<WhatsAppResult> => {
  const isUpdate = quote.kind === 'update'
  const brand = process.env.PDF_COMPANY_NAME || 'Deed Technologies'
  const salesEmail = process.env.SALES_EMAIL || process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke'
  const message = [
    `Hi ${quote.contactPersonName},`,
    '',
    isUpdate
      ? 'Please find the updated quotation below:'
      : 'Please find our quotation below:',
    '',
    `*Quote ${quote.ref}*${isUpdate ? ' (Updated)' : ''}`,
    `Company: ${quote.companyName}`,
    `Total: KES ${Number(quote.total || 0).toLocaleString()}`,
    `Valid until: ${quote.validUntil}`,
    '',
    quote.quoteUrl ? `View quote: ${quote.quoteUrl}` : 'Please check your email for the detailed PDF.',
    '',
    'Best regards,',
    'Sales',
    brand,
    salesEmail,
  ].join('\n')

  return sendWhatsAppMessage({
    to: quote.contactPhone,
    type: 'text',
    text: message,
  })
}

/**
 * Send Repair Ready Notification via WhatsApp
 */
export const sendRepairReadyWhatsApp = async (repair: {
  ref: string
  customerName: string
  customerPhone: string
  productName: string
  total: number
}) => {
  const message = `
Hi ${repair.customerName},

Good news! Your device repair is complete ✅

*Repair ${repair.ref}*
Device: ${repair.productName}
Amount Due: KES ${repair.total.toLocaleString()}

Your device is ready for pickup at our Westlands branch.

Please bring your repair receipt.

Opening Hours: Mon-Fri 8AM-6PM, Sat 9AM-3PM

Deed Technologies
Westlands, Nairobi
+254 20 123 4567
  `.trim()

  return sendWhatsAppMessage({
    to: repair.customerPhone,
    type: 'text',
    text: message,
  })
}

/**
 * Development Mode: Log WhatsApp message
 */
export const logWhatsAppForDev = (message: WhatsAppMessage) => {
  if (process.env.NODE_ENV === 'production') return
  console.log('═══ WHATSAPP (Development Mode) ═══')
  console.log('To:', message.to)
  console.log('Type:', message.type)
  if (message.text) console.log('Message:', message.text.slice(0, 100) + '...')
  if (message.templateName) console.log('Template:', message.templateName)
  console.log('════════════════════════════════════')
}
