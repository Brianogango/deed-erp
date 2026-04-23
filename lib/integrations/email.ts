// ─── Email Integration Layer ─────────────────────────────────────────────────

/**
 * Email Service Integration
 * 
 * Supports:
 * - SendGrid
 * - AWS SES
 * - Nodemailer (SMTP)
 * 
 * Configuration via environment variables:
 * - EMAIL_PROVIDER: 'sendgrid' | 'ses' | 'smtp'
 * - SENDGRID_API_KEY
 * - AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */

export interface EmailMessage {
  to: string | string[]
  cc?: string | string[]
  bcc?: string[]
  from?: string
  replyTo?: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType?: string
  }>
}

export interface EmailResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Send email using configured provider
 * 
 * NOTE: In development mode, emails are logged to console instead of sent.
 * Set NODE_ENV=production and configure email provider to enable sending.
 */
export const sendEmail = async (message: EmailMessage): Promise<EmailResult> => {
  // Development mode: Just log
  if (process.env.NODE_ENV !== 'production') {
    logEmailForDev(message)
    return {
      success: true,
      messageId: `dev-${Date.now()}`,
    }
  }

  const provider = process.env.EMAIL_PROVIDER || 'sendgrid'

  try {
    switch (provider) {
      case 'sendgrid':
        return await sendViaSendGrid(message)
      case 'ses':
        return await sendViaSES(message)
      case 'smtp':
        return await sendViaSMTP(message)
      default:
        return {
          success: false,
          error: `Unknown email provider: ${provider}`,
        }
    }
  } catch (error) {
    console.error('Email send error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * SendGrid Implementation
 * npm install @sendgrid/mail
 */
const sendViaSendGrid = async (message: EmailMessage): Promise<EmailResult> => {
  if (!process.env.SENDGRID_API_KEY) {
    return {
      success: false,
      error: 'SENDGRID_API_KEY not configured',
    }
  }

  try {
    const sgMail = await import('@sendgrid/mail')
    sgMail.default.setApiKey(process.env.SENDGRID_API_KEY)

    const result = await sgMail.default.send({
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      from: message.from || process.env.EMAIL_FROM || 'noreply@deed.co.ke',
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64'),
        type: att.contentType,
        disposition: 'attachment',
      })),
    })

    return {
      success: true,
      messageId: result[0].headers['x-message-id'],
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.body?.errors?.[0]?.message || error.message,
    }
  }
}

/**
 * AWS SES Implementation
 * npm install @aws-sdk/client-ses
 */
const sendViaSES = async (message: EmailMessage): Promise<EmailResult> => {
  if (!process.env.AWS_SES_REGION) {
    return {
      success: false,
      error: 'AWS SES not configured',
    }
  }

  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses')

    const client = new SESClient({
      region: process.env.AWS_SES_REGION,
      credentials: {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY!,
      },
    })

    const toArray = Array.isArray(message.to) ? message.to : [message.to]

    const command = new SendEmailCommand({
      Source: message.from || process.env.EMAIL_FROM || 'noreply@deed.co.ke',
      Destination: {
        ToAddresses: toArray,
        CcAddresses: message.cc ? (Array.isArray(message.cc) ? message.cc : [message.cc]) : undefined,
        BccAddresses: message.bcc,
      },
      Message: {
        Subject: { Data: message.subject },
        Body: {
          Html: { Data: message.html },
          Text: message.text ? { Data: message.text } : undefined,
        },
      },
    })

    const result = await client.send(command)

    return {
      success: true,
      messageId: result.MessageId,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * SMTP Implementation (Nodemailer)
 * npm install nodemailer
 */
const sendViaSMTP = async (message: EmailMessage): Promise<EmailResult> => {
  if (!process.env.SMTP_HOST) {
    return {
      success: false,
      error: 'SMTP not configured',
    }
  }

  try {
    const nodemailer = await import('nodemailer')

    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    const result = await transporter.sendMail({
      from: message.from || process.env.EMAIL_FROM || 'noreply@deed.co.ke',
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments,
    })

    return {
      success: true,
      messageId: result.messageId,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Email Templates
 */

export const generateQuoteEmail = (quote: {
  ref: string
  companyName: string
  contactPersonName: string
  total: number
  validUntil: string
  ownerName: string
  lines: Array<{ productName: string; qty: number; lineTotal: number }>
}) => {
  return {
    subject: `Quote ${quote.ref} from Deed Technologies`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #875BF7; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; }
          .quote-summary { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          .total { font-size: 18px; font-weight: bold; color: #875BF7; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">Deed Technologies</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">Your Technology Partner</p>
          </div>
          
          <div class="content">
            <p>Hello ${quote.contactPersonName},</p>
            
            <p>Thank you for your interest! We're pleased to present our quotation for ${quote.companyName}.</p>
            
            <div class="quote-summary">
              <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #875BF7;">
                Quote ${quote.ref}
              </h2>
              
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${quote.lines.map(line => `
                    <tr>
                      <td>${line.productName}</td>
                      <td style="text-align: center;">${line.qty}</td>
                      <td style="text-align: right;">KES ${line.lineTotal.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              
              <div style="text-align: right; margin-top: 20px; padding-top: 15px; border-top: 2px solid #875BF7;">
                <p style="margin: 5px 0; font-size: 14px;">Total Amount (incl. VAT)</p>
                <p class="total" style="margin: 0;">KES ${quote.total.toLocaleString()}</p>
              </div>
            </div>
            
            <p><strong>Valid Until:</strong> ${quote.validUntil}</p>
            
            <p>To accept this quote, please reply to this email or contact your account manager ${quote.ownerName}.</p>
            
            <p>If you have any questions, feel free to reach out!</p>
            
            <p>Best regards,<br>
            <strong>${quote.ownerName}</strong><br>
            Deed Technologies<br>
            <a href="mailto:sales@deed.co.ke">sales@deed.co.ke</a> | +254 20 123 4567</p>
          </div>
          
          <div class="footer">
            <p>Deed Technologies Ltd · Westlands, Nairobi · deed.co.ke</p>
            <p style="font-size: 10px; color: #999;">This is an automated message from Deed ERP.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Quote ${quote.ref} from Deed Technologies

Hello ${quote.contactPersonName},

Thank you for your interest! We're pleased to present our quotation for ${quote.companyName}.

Quote Details:
${quote.lines.map(line => `${line.productName} × ${line.qty} = KES ${line.lineTotal.toLocaleString()}`).join('\n')}

TOTAL (incl. VAT): KES ${quote.total.toLocaleString()}

Valid Until: ${quote.validUntil}

To accept this quote, please reply to this email or contact ${quote.ownerName}.

Best regards,
${quote.ownerName}
Deed Technologies
sales@deed.co.ke | +254 20 123 4567
    `.trim(),
  }
}

/**
 * Send Quote via Email
 */
export const sendQuoteEmail = async (quote: Parameters<typeof generateQuoteEmail>[0]): Promise<EmailResult> => {
  const emailContent = generateQuoteEmail(quote)
  
  // In production, also attach PDF
  return sendEmail({
    to: 'customer@example.com',  // Replace with actual contact email
    ...emailContent,
  })
}

/**
 * Development Mode: Log email instead of sending
 */
export const logEmailForDev = (message: EmailMessage) => {
  console.log('═══ EMAIL (Development Mode) ═══')
  console.log('To:', message.to)
  console.log('Subject:', message.subject)
  console.log('HTML Length:', message.html.length, 'chars')
  if (message.attachments) {
    console.log('Attachments:', message.attachments.map(a => a.filename).join(', '))
  }
  console.log('════════════════════════════════')
}
