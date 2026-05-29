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
}

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0'

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
    }
  }

  try {
    let payload: any = {
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

    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || 'WhatsApp API error',
      }
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
  ownerName: string
  quoteUrl?: string
}): Promise<WhatsAppResult> => {
  const message = `
Hi ${quote.contactPersonName},

Thank you for your interest! Your quotation is ready:

*Quote ${quote.ref}*
Company: ${quote.companyName}
Total: KES ${quote.total.toLocaleString()}
Valid Until: ${quote.validUntil}

${quote.quoteUrl ? `View quote: ${quote.quoteUrl}` : 'Please check your email for the detailed quote.'}

To accept or discuss, please reply to this message or contact:
${quote.ownerName}
Deed Technologies
+254 20 123 4567

Thank you!
  `.trim()

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
