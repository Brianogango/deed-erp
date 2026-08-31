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
export type MailboxProfile = 'default' | 'hr' | 'sales' | 'accounts' | 'repairs' | 'procurement'

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
  /** Visible From address (department mailbox for sales/accounts/hr). */
  from: string
  /** Reply-To — same department address so replies land in the right inbox. */
  replyTo: string
  /** True when auth user is the department mailbox (not the shared default login). */
  dedicatedAuth: boolean
}

/**
 * Authenticate as the department address (From = Reply-To = department).
 * Used for sales@ where the cPanel mailbox exists and shares SMTP_PASS.
 * Contabo rejects From≠auth-user, so we do not send From=hello@ as sales@.
 */
const departmentMailbox = (
  departmentFrom: string,
  dedicatedUser: string | undefined,
  dedicatedPass: string | undefined,
  def: MailboxConfig,
): MailboxConfig => {
  const department = (departmentFrom || '').trim() || def.from
  const user = (dedicatedUser || department || def.user).trim()
  const pass = (dedicatedPass || def.pass || '').trim()
  const dedicatedAuth = !!(user && pass && user.toLowerCase() !== def.user.toLowerCase())
    || !!(dedicatedUser && dedicatedPass)
  return {
    user: user || def.user,
    pass: pass || def.pass,
    from: department,
    replyTo: department,
    dedicatedAuth: dedicatedAuth || user.toLowerCase() === department.toLowerCase(),
  }
}

/**
 * For hr@ / accounts@ when the mailbox is not provisioned in cPanel yet:
 * if dedicated *_SMTP_USER + *_SMTP_PASS are unset, authenticate as the default
 * SMTP user (hello@) and keep Reply-To on the department address so replies
 * still route correctly. Never send From=hr@ while authenticating as hello@.
 */
const departmentMailboxWithDefaultFallback = (
  departmentFrom: string,
  dedicatedUser: string | undefined,
  dedicatedPass: string | undefined,
  def: MailboxConfig,
): MailboxConfig => {
  const department = (departmentFrom || '').trim() || def.from
  const hasDedicated = Boolean(
    (dedicatedUser || '').trim() && (dedicatedPass || '').trim(),
  )
  if (hasDedicated) {
    return {
      user: (dedicatedUser as string).trim(),
      pass: (dedicatedPass as string).trim(),
      from: department,
      replyTo: department,
      dedicatedAuth: true,
    }
  }
  return {
    user: def.user,
    pass: def.pass,
    from: def.from,
    replyTo: department,
    dedicatedAuth: false,
  }
}

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
    return departmentMailboxWithDefaultFallback(
      process.env.HR_EMAIL || process.env.HR_SMTP_USER || 'hr@deed.co.ke',
      process.env.HR_SMTP_USER,
      process.env.HR_SMTP_PASS,
      def,
    )
  }
  if (profile === 'sales') {
    return departmentMailbox(
      process.env.SALES_EMAIL || process.env.SALES_SMTP_USER || 'sales@deed.co.ke',
      process.env.SALES_SMTP_USER,
      process.env.SALES_SMTP_PASS,
      def,
    )
  }
  if (profile === 'accounts') {
    return departmentMailboxWithDefaultFallback(
      process.env.ACCOUNTS_EMAIL || process.env.ACCOUNTS_SMTP_USER || 'accounts@deed.co.ke',
      process.env.ACCOUNTS_SMTP_USER,
      process.env.ACCOUNTS_SMTP_PASS,
      def,
    )
  }
  if (profile === 'repairs') {
    return departmentMailboxWithDefaultFallback(
      process.env.REPAIRS_EMAIL || process.env.REPAIRS_SMTP_USER || 'repairs@deed.co.ke',
      process.env.REPAIRS_SMTP_USER,
      process.env.REPAIRS_SMTP_PASS,
      def,
    )
  }
  if (profile === 'procurement') {
    return departmentMailboxWithDefaultFallback(
      process.env.PROCUREMENT_EMAIL || process.env.PROCUREMENT_SMTP_USER || 'procurement@deed.co.ke',
      process.env.PROCUREMENT_SMTP_USER,
      process.env.PROCUREMENT_SMTP_PASS,
      def,
    )
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

  const profiles: MailboxProfile[] = ['default', 'hr', 'sales', 'accounts', 'repairs', 'procurement']
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

const smtpTransportCache = (() => {
  const root = globalThis as unknown as { __deedSmtpTransporters?: Map<string, any> }
  if (!root.__deedSmtpTransporters) root.__deedSmtpTransporters = new Map<string, any>()
  return root.__deedSmtpTransporters
})()

function envNumber(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.floor(raw)))
}

function smtpTransportKey(profile: MailboxProfile, mailbox: MailboxConfig) {
  return [
    process.env.SMTP_HOST || '',
    process.env.SMTP_PORT || '587',
    process.env.SMTP_SECURE || 'false',
    profile,
    mailbox.user,
  ].join('|')
}

async function getSmtpTransporter(profile: MailboxProfile, mailbox: MailboxConfig) {
  const key = smtpTransportKey(profile, mailbox)
  const cached = smtpTransportCache.get(key)
  if (cached) return cached

  const nodemailer = await import('nodemailer')
  const port = Number(process.env.SMTP_PORT) || 587
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
  const transporter = nodemailer.default.createTransport({
    pool: true,
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && process.env.SMTP_REQUIRE_TLS !== 'false',
    auth: {
      user: mailbox.user,
      pass: mailbox.pass,
    },
    maxConnections: envNumber('SMTP_MAX_CONNECTIONS', 3, 1, 20),
    maxMessages: envNumber('SMTP_MAX_MESSAGES_PER_CONNECTION', 100, 1, 1000),
    rateDelta: envNumber('SMTP_RATE_DELTA_MS', 1000, 100, 60_000),
    rateLimit: envNumber('SMTP_RATE_LIMIT', 8, 1, 100),
    connectionTimeout: envNumber('SMTP_CONNECTION_TIMEOUT_MS', 10_000, 1000, 120_000),
    greetingTimeout: envNumber('SMTP_GREETING_TIMEOUT_MS', 10_000, 1000, 120_000),
    socketTimeout: envNumber('SMTP_SOCKET_TIMEOUT_MS', 30_000, 1000, 300_000),
    tls: {
      rejectUnauthorized,
      servername: process.env.SMTP_TLS_SERVERNAME || process.env.SMTP_HOST,
      minVersion: 'TLSv1.2',
    },
  })

  transporter.on('error', (error: unknown) => {
    console.error('[email] pooled SMTP transporter error', {
      profile,
      host: process.env.SMTP_HOST,
      user: mailbox.user,
      error: error instanceof Error ? error.message : String(error),
    })
    smtpTransportCache.delete(key)
  })

  smtpTransportCache.set(key, transporter)
  return transporter
}

/**
 * SMTP Implementation (Nodemailer)
 * Uses a bounded connection pool, TLS certificate verification and explicit
 * connection/greeting/socket timeouts. Set SMTP_TLS_REJECT_UNAUTHORIZED=false
 * only as a temporary emergency override for a known private certificate.
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

  const requestedFrom = (message.from || '').trim()
  const authUser = mailbox.user.trim().toLowerCase()
  const mailboxFrom = mailbox.from.trim()
  const fromAllowed =
    !requestedFrom
    || requestedFrom.toLowerCase() === authUser
    || requestedFrom.toLowerCase() === mailboxFrom.toLowerCase()
  const from = fromAllowed && requestedFrom ? requestedFrom : mailboxFrom
  const replyTo = (message.replyTo || mailbox.replyTo || mailbox.from).trim() || from

  try {
    const transporter = await getSmtpTransporter(profile, mailbox)
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
      console.error('[email] SMTP rejected all recipients', { profile, to: message.to, from, replyTo, authUser: mailbox.user, rejected, reason })
      return { success: false, error: `Mail server rejected the recipient(s): ${reason}` }
    }
    if (rejected.length > 0) {
      console.warn('[email] SMTP partial delivery', { profile, accepted, rejected, from, replyTo })
    } else {
      console.log('[email] SMTP sent', { profile, to: message.to, from, replyTo, authUser: mailbox.user, messageId: result.messageId })
    }
    return {
      success: true,
      messageId: result.messageId,
    }
  } catch (error: any) {
    const responseCode = error?.responseCode
    const response = String(error?.response || error?.message || '')
    const authFailed = error?.code === 'EAUTH' || responseCode === 535 || /authentication|login/i.test(response)
    const senderRejected = /sender|from address|not owned|not allowed|relay/i.test(response)
    const tlsFailed = /certificate|self signed|unable to verify|tls/i.test(response)
    const timedOut = error?.code === 'ETIMEDOUT' || /timeout/i.test(response)
    const friendly = authFailed
      ? `SMTP login failed for ${mailbox.user}. Create that mailbox in cPanel (or set ${String(profile).toUpperCase()}_SMTP_USER/PASS) so From/Reply-To can be ${from}.`
      : tlsFailed
        ? `SMTP TLS validation failed for ${process.env.SMTP_HOST}. Fix the mail-server certificate/hostname; do not disable verification permanently.`
      : timedOut
        ? `SMTP connection to ${process.env.SMTP_HOST} timed out. Check firewall, port, DNS and mail-server availability.`
      : responseCode === 550 && senderRejected
        ? `Mail server rejected the sender address (${from}). Authenticate as ${from} or create it as an alias.`
        : responseCode === 550
          ? 'Mail server rejected the recipient (550 No Such User Here). Please ensure the mailbox exists.'
          : (error?.message || 'Unknown SMTP error')
    console.error('[email] SMTP send failed', {
      profile,
      to: message.to,
      from,
      replyTo,
      authUser: mailbox.user,
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

export type QuoteEmailKind = 'initial' | 'update'

const quoteCompanyName = () => process.env.PDF_COMPANY_NAME || 'Deed Technologies'
const quoteSalesEmail = () => process.env.SALES_EMAIL || process.env.PDF_COMPANY_EMAIL || 'sales@deed.co.ke'

/**
 * Sales quotation email — first send vs update.
 * Body ends after the quote with a Sales signature only (no phone, no accept CTA).
 * PDF is expected as an attachment; optional download URL adds an in-body button.
 */
export const generateQuoteEmail = (quote: {
  ref: string
  companyName: string
  contactPersonName: string
  total: number
  validUntil: string
  ownerName?: string
  lines: Array<{ productName: string; qty: number; lineTotal: number }>
  /** Optional personal message written by the sender. */
  message?: string
  /** First send vs revised quotation. */
  kind?: QuoteEmailKind
  /** When true (default), tell the recipient the PDF is attached. */
  pdfAttached?: boolean
  /** Optional public/signed URL for an in-email Download PDF button. */
  pdfDownloadUrl?: string
  /** Optional signed customer-portal URL — lets the recipient accept/reject online. */
  portalLink?: string
}) => {
  const brand = quoteCompanyName()
  const salesEmail = quoteSalesEmail()
  const isUpdate = quote.kind === 'update'
  const hasMessage = Boolean(quote.message?.trim())
  const pdfAttached = quote.pdfAttached !== false
  const greetingName = escapeHtml(quote.contactPersonName || quote.companyName || 'there')
  const company = escapeHtml(quote.companyName || 'your organisation')
  const ref = escapeHtml(quote.ref)
  const validUntil = escapeHtml(quote.validUntil || '—')

  const subject = isUpdate
    ? `Updated Quote ${quote.ref} — ${brand}`
    : `Quote ${quote.ref} — ${brand}`

  const introHtml = hasMessage
    ? ''
    : isUpdate
      ? `<p>Please find the <strong>updated quotation</strong> for ${company} below.</p>`
      : `<p>Please find our quotation for ${company} below.</p>`

  const downloadHtml = quote.pdfDownloadUrl
    ? `
            <p style="margin: 20px 0 8px 0;">
              <a href="${escapeHtml(quote.pdfDownloadUrl)}"
                 style="display:inline-block;background:#1A1F5E;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">
                Download PDF
              </a>
            </p>
            ${pdfAttached ? `<p style="margin:0;font-size:13px;color:#64748B;">The quotation PDF is also attached to this email.</p>` : ''}`
    : pdfAttached
      ? `<p style="margin:20px 0 0 0;font-size:14px;">The full quotation PDF is <strong>attached</strong> to this email — open the attachment to download.</p>`
      : ''

  const portalHtml = quote.portalLink
    ? `
            <p style="margin: 20px 0 8px 0;">
              <a href="${escapeHtml(quote.portalLink)}"
                 style="display:inline-block;background:#00AEEF;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">
                View &amp; Respond Online
              </a>
            </p>
            <p style="margin:0;font-size:13px;color:#64748B;">Accept or decline this quotation directly from your browser — no account needed.</p>`
    : ''

  const lineRows = quote.lines.map(line => `
                    <tr>
                      <td>${escapeHtml(line.productName)}</td>
                      <td style="text-align: center;">${line.qty}</td>
                      <td style="text-align: right;">KES ${Number(line.lineTotal || 0).toLocaleString()}</td>
                    </tr>`).join('')

  return {
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1A1F5E; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; }
          .quote-summary { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #e5e7eb; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          .total { font-size: 18px; font-weight: bold; color: #1A1F5E; }
          .badge { display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:${isUpdate ? '#FEF3C7' : '#E0E7FF'};color:${isUpdate ? '#92400E' : '#1A1F5E'}; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">${escapeHtml(brand)}</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">${isUpdate ? 'Updated quotation' : 'Quotation'}</p>
          </div>

          <div class="content">
            <p>Hello ${greetingName},</p>
            ${hasMessage ? `<p style="white-space: pre-wrap;">${escapeHtml(quote.message!.trim())}</p>` : ''}
            ${introHtml}

            <div class="quote-summary">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 15px 0;flex-wrap:wrap;">
                <h2 style="margin: 0; font-size: 18px; color: #1A1F5E;">
                  Quote ${ref}
                </h2>
                <span class="badge">${isUpdate ? 'Updated' : 'New'}</span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${lineRows}
                </tbody>
              </table>

              <div style="text-align: right; margin-top: 20px; padding-top: 15px; border-top: 2px solid #1A1F5E;">
                <p style="margin: 5px 0; font-size: 14px;">Total Amount (incl. VAT)</p>
                <p class="total" style="margin: 0;">KES ${Number(quote.total || 0).toLocaleString()}</p>
              </div>
              <p style="margin: 16px 0 0 0; font-size: 13px; color: #64748B;"><strong>Valid until:</strong> ${validUntil}</p>
            </div>

            ${portalHtml}
            ${downloadHtml}

            <p style="margin: 28px 0 0 0;">Best regards,<br>
            <strong>Sales</strong><br>
            ${escapeHtml(brand)}<br>
            <a href="mailto:${escapeHtml(salesEmail)}">${escapeHtml(salesEmail)}</a></p>
          </div>

          <div class="footer">
            <p>${escapeHtml(brand)}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: [
      subject,
      '',
      `Hello ${quote.contactPersonName || quote.companyName || 'there'},`,
      '',
      hasMessage ? quote.message!.trim() : '',
      hasMessage ? '' : (isUpdate
        ? `Please find the updated quotation for ${quote.companyName} below.`
        : `Please find our quotation for ${quote.companyName} below.`),
      '',
      `Quote ${quote.ref}${isUpdate ? ' (Updated)' : ''}`,
      ...quote.lines.map(line => `${line.productName} × ${line.qty} = KES ${Number(line.lineTotal || 0).toLocaleString()}`),
      '',
      `TOTAL (incl. VAT): KES ${Number(quote.total || 0).toLocaleString()}`,
      `Valid until: ${quote.validUntil}`,
      '',
      quote.portalLink ? `View & respond online: ${quote.portalLink}` : '',
      quote.pdfDownloadUrl ? `Download PDF: ${quote.pdfDownloadUrl}` : '',
      pdfAttached ? 'The full quotation PDF is attached to this email.' : '',
      '',
      'Best regards,',
      'Sales',
      brand,
      salesEmail,
    ].filter(line => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
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
