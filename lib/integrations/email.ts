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

/**
 * Logical mailbox profile. Selects which SMTP credentials & default From address are used.
 * Falls back to the default profile when env vars for the requested profile are missing.
 */
export type MailboxProfile = 'default' | 'hr' | 'sales' | 'accounts'

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
  /** Which mailbox to send through. Defaults to the global SMTP_USER/EMAIL_FROM. */
  mailbox?: MailboxProfile
}

interface MailboxConfig {
  user: string
  pass: string
  /** Envelope / visible From — must be allowed by the SMTP login on Contabo/cPanel. */
  from: string
  /** Department address for customer replies (e.g. sales@ / accounts@). */
  replyTo: string
  /** True when this profile has its own SMTP_USER/PASS (safe to From as department). */
  dedicatedAuth: boolean
}

const profileAuth = (
  user: string | undefined,
  pass: string | undefined,
  fallback: MailboxConfig,
): Pick<MailboxConfig, 'user' | 'pass' | 'dedicatedAuth'> => {
  if (user && pass) {
    return { user, pass, dedicatedAuth: true }
  }
  return { user: fallback.user, pass: fallback.pass, dedicatedAuth: false }
}

/**
 * Contabo/cPanel SMTP typically only allows From = authenticated mailbox (or
 * an alias of it). When a department profile reuses the default SMTP login,
 * keep From as EMAIL_FROM/SMTP_USER and put the department address on Reply-To.
 */
const departmentMailbox = (
  departmentFrom: string,
  auth: Pick<MailboxConfig, 'user' | 'pass' | 'dedicatedAuth'>,
  def: MailboxConfig,
): MailboxConfig => ({
  user: auth.user,
  pass: auth.pass,
  dedicatedAuth: auth.dedicatedAuth,
  from: auth.dedicatedAuth ? departmentFrom : def.from,
  replyTo: departmentFrom || def.replyTo || def.from,
})

/** Exported for tests / diagnostics. */
export const pickMailbox = (profile: MailboxProfile): MailboxConfig => {
  const defFrom = process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? 'noreply@deed.co.ke'
  const def: MailboxConfig = {
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: defFrom,
    replyTo: defFrom,
    dedicatedAuth: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
  }
  if (profile === 'hr') {
    const auth = profileAuth(process.env.HR_SMTP_USER, process.env.HR_SMTP_PASS, def)
    const department = process.env.HR_EMAIL || process.env.HR_SMTP_USER || def.from
    return departmentMailbox(department, auth, def)
  }
  if (profile === 'sales') {
    const auth = profileAuth(process.env.SALES_SMTP_USER, process.env.SALES_SMTP_PASS, def)
    const department = process.env.SALES_EMAIL || process.env.SALES_SMTP_USER || def.from
    return departmentMailbox(department, auth, def)
  }
  if (profile === 'accounts') {
    const auth = profileAuth(process.env.ACCOUNTS_SMTP_USER, process.env.ACCOUNTS_SMTP_PASS, def)
    const department = process.env.ACCOUNTS_EMAIL || process.env.ACCOUNTS_SMTP_USER || def.from
    return departmentMailbox(department, auth, def)
  }
  return def
}

/**
 * Resolve which provider to use.
 * If EMAIL_PROVIDER is unset but SMTP_HOST is present, prefer SMTP
 * (avoids failing SendGrid when only Contabo mail is configured).
 */
export function resolveEmailProvider(): 'sendgrid' | 'ses' | 'smtp' {
  const explicit = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'sendgrid' || explicit === 'ses' || explicit === 'smtp') return explicit
  if (process.env.SMTP_HOST) return 'smtp'
  return 'sendgrid'
}

export type EmailConfigStatus = {
  ready: boolean
  provider: 'sendgrid' | 'ses' | 'smtp'
  nodeEnv: string
  fromDefault: string
  mailboxes: Array<{
    id: MailboxProfile
    from: string
    replyTo: string
    dedicatedAuth: boolean
    authConfigured: boolean
  }>
  missing: string[]
  hints: string[]
}

/** Safe diagnostics for Settings — never returns passwords. */
export function getEmailConfigStatus(): EmailConfigStatus {
  const provider = resolveEmailProvider()
  const missing: string[] = []
  const hints: string[] = []

  if (provider === 'smtp') {
    if (!process.env.SMTP_HOST) missing.push('SMTP_HOST')
    if (!process.env.SMTP_USER) missing.push('SMTP_USER')
    if (!process.env.SMTP_PASS) missing.push('SMTP_PASS')
    if (!process.env.EMAIL_FROM && !process.env.SMTP_USER) missing.push('EMAIL_FROM')
  } else if (provider === 'sendgrid') {
    if (!process.env.SENDGRID_API_KEY) missing.push('SENDGRID_API_KEY')
    if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM')
  } else if (provider === 'ses') {
    if (!process.env.AWS_SES_REGION) missing.push('AWS_SES_REGION')
    if (!process.env.AWS_SES_ACCESS_KEY_ID) missing.push('AWS_SES_ACCESS_KEY_ID')
    if (!process.env.AWS_SES_SECRET_ACCESS_KEY) missing.push('AWS_SES_SECRET_ACCESS_KEY')
    if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM')
  }

  const profiles: MailboxProfile[] = ['default', 'hr', 'sales', 'accounts']
  const mailboxes = profiles.map(id => {
    const cfg = pickMailbox(id)
    return {
      id,
      from: cfg.from,
      replyTo: cfg.replyTo,
      dedicatedAuth: cfg.dedicatedAuth,
      authConfigured: provider !== 'smtp' ? missing.length === 0 : !!(cfg.user && cfg.pass),
    }
  })

  if (process.env.NODE_ENV !== 'production') {
    hints.push('Non-production mode logs emails to the server console instead of sending.')
  }
  if (provider === 'smtp' && process.env.SMTP_HOST && !process.env.EMAIL_PROVIDER) {
    hints.push('EMAIL_PROVIDER not set — auto-selected smtp because SMTP_HOST is present.')
  }
  if (missing.length === 0 && process.env.NODE_ENV === 'production') {
    hints.push('Config looks complete. Use “Send test email” to verify delivery.')
  }

  return {
    ready: missing.length === 0 && process.env.NODE_ENV === 'production',
    provider,
    nodeEnv: process.env.NODE_ENV || 'development',
    fromDefault: process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@deed.co.ke',
    mailboxes,
    missing,
    hints,
  }
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

  const provider = resolveEmailProvider()

  try {
    switch (provider) {
      case 'sendgrid':
        return await sendViaSendGrid(message)
      case 'ses':
        return await sendViaSES(message)
      case 'smtp':
        return await sendViaSMTP(message)
      default:
        return { success: false, error: `Unknown email provider: ${provider}` }
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
  const profile = message.mailbox ?? 'default'
  const mailbox = pickMailbox(profile)
  if (!mailbox.user || !mailbox.pass) {
    return {
      success: false,
      error: `SMTP credentials not configured for mailbox profile "${profile}"`,
    }
  }
  // Prefer Reply-To from the caller, else the department address. Never let a
  // mismatched From override the Contabo-safe mailbox.from unless this profile
  // has dedicated SMTP credentials (or the caller From matches the login).
  const requestedFrom = (message.from || '').trim()
  const authUser = mailbox.user.trim().toLowerCase()
  const fromAllowed =
    !requestedFrom
    || mailbox.dedicatedAuth
    || requestedFrom.toLowerCase() === authUser
    || requestedFrom.toLowerCase() === mailbox.from.trim().toLowerCase()
  const from = fromAllowed && requestedFrom ? requestedFrom : mailbox.from
  const replyTo = message.replyTo || mailbox.replyTo || mailbox.from
  try {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: mailbox.user,
        pass: mailbox.pass,
      },
      tls: { rejectUnauthorized: false },
    })
    const result = await transporter.sendMail({
      from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments,
    })
    const accepted = (result.accepted || []) as string[]
    const rejected = (result.rejected || []) as string[]
    if (accepted.length === 0 && rejected.length > 0) {
      const reason = (result as { response?: string }).response || 'all recipients rejected'
      console.error('[email] SMTP rejected all recipients', { profile, to: message.to, from, replyTo, rejected, reason })
      return { success: false, error: `Mail server rejected the recipient(s): ${reason}` }
    }
    if (rejected.length > 0) {
      console.warn('[email] SMTP partial delivery', { profile, accepted, rejected, from, replyTo })
    } else {
      console.log('[email] SMTP sent', { profile, to: message.to, from, replyTo, messageId: result.messageId })
    }
    return {
      success: true,
      messageId: result.messageId,
    }
  } catch (error: any) {
    const responseCode = error?.responseCode
    const response = String(error?.response || error?.message || '')
    const senderRejected = /sender|from address|not owned|not allowed|relay/i.test(response)
    const friendly = responseCode === 550 && senderRejected
      ? `Mail server rejected the sender address (${from}). Use a From that matches the SMTP login, or create ${from} as an alias.`
      : responseCode === 550
        ? `Mail server rejected the recipient (550 No Such User Here). Please ensure the mailbox exists.`
        : (error?.message || 'Unknown SMTP error')
    console.error('[email] SMTP send failed', {
      profile,
      to: message.to,
      from,
      replyTo,
      code: error?.code,
      responseCode,
      message: error?.message,
    })
    return {
      success: false,
      error: friendly,
    }
  }
}

/**
 * Email Templates
 */

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const generateQuoteEmail = (quote: {
  ref: string
  companyName: string
  contactPersonName: string
  total: number
  validUntil: string
  ownerName: string
  lines: Array<{ productName: string; qty: number; lineTotal: number }>
  /** Optional personal message written by the sender. */
  message?: string
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
            ${quote.message ? `<p style="white-space: pre-wrap;">${escapeHtml(quote.message)}</p>` : ''}
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

${quote.message ? `${quote.message}\n\n` : ''}Thank you for your interest! We're pleased to present our quotation for ${quote.companyName}.

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

export const generateRfqEmail = (rfq: {
  ref: string
  vendorName: string
  companyName: string
  expectedDate?: string
  notes?: string
  lines: Array<{ productName: string; qty: number; unitPrice: number; subtotal: number }>
  subtotal: number
  taxTotal: number
  total: number
  senderName?: string
  message?: string
}) => {
  const company = escapeHtml(rfq.companyName || 'Deed Technologies')
  const vendor = escapeHtml(rfq.vendorName || 'Vendor')
  const rows = rfq.lines.map((line, index) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${index + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(line.productName)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${line.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">KES ${Number(line.unitPrice || 0).toLocaleString()}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">KES ${Number(line.subtotal || 0).toLocaleString()}</td>
    </tr>`).join('')

  return {
    subject: `RFQ ${rfq.ref} from ${rfq.companyName || 'Deed Technologies'}`,
    html: `
<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#333;">
  <div style="max-width:640px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
    <h2 style="margin:0 0 8px;color:#1A1F5E;">Request for Quotation</h2>
    <p style="margin:0 0 16px;color:#64748B;">${escapeHtml(rfq.ref)} · ${company}</p>
    <p>Hello ${vendor},</p>
    ${rfq.message ? `<p>${escapeHtml(rfq.message)}</p>` : ''}
    <p>Please quote availability, lead time, payment terms, and final pricing for the items below.</p>
    ${rfq.expectedDate ? `<p><strong>Expected date:</strong> ${escapeHtml(rfq.expectedDate)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <thead>
        <tr style="background:#F8FAFC;text-align:left;">
          <th style="padding:8px;">#</th>
          <th style="padding:8px;">Item</th>
          <th style="padding:8px;text-align:right;">Qty</th>
          <th style="padding:8px;text-align:right;">Target</th>
          <th style="padding:8px;text-align:right;">Line</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right;margin:0;"><strong>Subtotal:</strong> KES ${Number(rfq.subtotal || 0).toLocaleString()}</p>
    <p style="text-align:right;margin:4px 0;"><strong>Tax:</strong> KES ${Number(rfq.taxTotal || 0).toLocaleString()}</p>
    <p style="text-align:right;margin:4px 0 16px;font-size:16px;"><strong>Expected total:</strong> KES ${Number(rfq.total || 0).toLocaleString()}</p>
    ${rfq.notes ? `<p><strong>Notes:</strong> ${escapeHtml(rfq.notes)}</p>` : ''}
    <p>Regards,<br/>${escapeHtml(rfq.senderName || company)}</p>
  </div>
</body></html>`,
    text: [
      `RFQ ${rfq.ref} from ${rfq.companyName || 'Deed Technologies'}`,
      '',
      `Hello ${rfq.vendorName || 'Vendor'},`,
      rfq.message || '',
      'Please quote for the items below.',
      rfq.expectedDate ? `Expected date: ${rfq.expectedDate}` : '',
      '',
      ...rfq.lines.map((l, i) => `${i + 1}. ${l.productName} — Qty ${l.qty} — Target KES ${Number(l.unitPrice || 0).toLocaleString()}`),
      '',
      `Expected total: KES ${Number(rfq.total || 0).toLocaleString()}`,
      rfq.notes ? `Notes: ${rfq.notes}` : '',
      '',
      `Regards, ${rfq.senderName || rfq.companyName || 'Deed Technologies'}`,
    ].filter(Boolean).join('\n'),
  }
}

/**
 * Send Quote via Email
 */
export const sendQuoteEmail = async (quote: Parameters<typeof generateQuoteEmail>[0] & { to: string }): Promise<EmailResult> => {
  const emailContent = generateQuoteEmail(quote)
  return sendEmail({
    to: quote.to,
    mailbox: 'sales',
    ...emailContent,
  })
}

/**
 * Development Mode: Log email instead of sending
 */
export const logEmailForDev = (message: EmailMessage) => {
  if (process.env.NODE_ENV === 'production') return
  console.log('═══ EMAIL (Development Mode) ═══')
  console.log('To:', message.to)
  console.log('Subject:', message.subject)
  console.log('HTML Length:', message.html.length, 'chars')
  if (message.attachments) {
    console.log('Attachments:', message.attachments.map(a => a.filename).join(', '))
  }
  console.log('════════════════════════════════')
}
