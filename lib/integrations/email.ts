import { brandedEmailHtml, emailParagraph, emailSignature, emailTableHtml, emailTotalsHtml, wrapEmailFragment, type BrandedAction } from '@/lib/email/branded-layout'
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
  /**
   * A personal email (a rep writing to a customer): sent as written, without
   * the branded frame every other ERP email gets.
   */
  plain?: boolean
  /**
   * Send as a staff member (e.g. the leave applicant): From shows their name and
   * company work email, while the ERP still signs in as the mailbox above —
   * so no staff password is ever needed. If the mail server refuses that
   * From, it falls back to "Jane Wanjiku (via Deed HR)" <hr@…>.
   */
  senderName?: string
  senderEmail?: string
  /** Thread a reply under the customer's message (SMTP only). */
  inReplyTo?: string
  references?: string | string[]
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

type EmailConfigStatus = {
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
export const sendEmail = async (input: EmailMessage): Promise<EmailResult> => {
  // Every system email gets the same branded frame (logo, footer); a body
  // that is already a full document, or a personal email, is sent as is.
  const message: EmailMessage = input.plain || !input.html
    ? input
    : { ...input, html: wrapEmailFragment(input.html, input.subject) }
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

const PROFILE_LABEL: Record<MailboxProfile, string> = { default: 'Deed ERP', hr: 'Deed HR', sales: 'Deed Sales', accounts: 'Deed Accounts' }

const domainOf = (address: string) => address.trim().toLowerCase().split('@')[1] || ''
/** Set when the mail server refused a staff From, so later emails go straight to the fallback. */
let staffFromRefusedUntil = 0

/**
 * The From to try first: the person's own work email, but only on the
 * company's own domain (never an outside address), and not while the server
 * is known to refuse it. EMAIL_SEND_AS_STAFF=false keeps names only.
 */
export function staffFromAddress(senderEmail: string | undefined, mailbox: Pick<MailboxConfig, 'user' | 'from'>, now = Date.now()): string | undefined {
  const email = (senderEmail || '').trim().toLowerCase()
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return undefined
  if (process.env.EMAIL_SEND_AS_STAFF === 'false' || now < staffFromRefusedUntil) return undefined
  const ownDomain = domainOf(mailbox.from) || domainOf(mailbox.user)
  return ownDomain && domainOf(email) === ownDomain ? email : undefined
}

/** "Jane Wanjiku (via Deed HR)" — the person's name on the department mailbox's address. */
export function staffDisplayName(senderName: string | undefined, profile: MailboxProfile): string | undefined {
  const name = (senderName || '').replace(/["<>\\]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return name ? `${name} (via ${PROFILE_LABEL[profile]})` : undefined
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
  const displayName = staffDisplayName(message.senderName, profile)
  const staffEmail = staffFromAddress(message.senderEmail, mailbox)
  const plainName = (displayName || '').replace(/ \(via [^)]*\)$/, '') || staffEmail || ''
  const fallbackFrom = displayName ? { name: displayName, address: from } : from
  // First choice: the person's own work email; the signed-in mailbox is the
  // Sender (and the envelope MAIL FROM), so their password is never needed.
  const attempts: Array<{ from: string | { name: string; address: string }; sender?: string }> = staffEmail
    ? [{ from: { name: plainName, address: staffEmail }, sender: mailbox.user.trim() }, { from: fallbackFrom }]
    : [{ from: fallbackFrom }]

  for (let attempt = 0; ; attempt += 1) {
    const { from: tryFrom, sender } = attempts[attempt]
    try {
      const transporter = await getSmtpTransporter(profile, mailbox)
      const result = await transporter.sendMail({
        from: tryFrom,
        ...(sender ? { sender } : {}),
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references ? { references: message.references } : {}),
      })
      const accepted = (result.accepted || []) as string[]
      const rejected = (result.rejected || []) as string[]
      if (accepted.length === 0 && rejected.length > 0) {
        const reason = (result as { response?: string }).response || 'all recipients rejected'
        console.error('[email] SMTP rejected all recipients', { profile, to: message.to, from: tryFrom, replyTo, authUser: mailbox.user, rejected, reason })
        return { success: false, error: `Mail server rejected the recipient(s): ${reason}` }
      }
      if (rejected.length > 0) {
        console.warn('[email] SMTP partial delivery', { profile, accepted, rejected, from: tryFrom, replyTo })
      } else {
        console.log('[email] SMTP sent', { profile, to: message.to, from: tryFrom, replyTo, authUser: mailbox.user, messageId: result.messageId })
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
      const recipientProblem = error?.command === 'RCPT TO' || /recipient|no such user|mailbox unavailable|user unknown/i.test(response)
      if (sender && attempt + 1 < attempts.length && Number(responseCode) >= 500 && !authFailed && !recipientProblem) {
        // The server refused the staff From: send via the mailbox's own address
        // now, and for the next 6 hours, instead of failing.
        console.warn('[email] mail server refused staff From; using the department address', { profile, from: tryFrom, authUser: mailbox.user, responseCode, response: response.slice(0, 200) })
        staffFromRefusedUntil = Date.now() + 6 * 60 * 60 * 1000
        continue
      }
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
        from: tryFrom,
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
}

/**
 * Email Templates
 */

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type QuoteEmailKind = 'initial' | 'update'

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
  const subject = isUpdate
    ? `Updated Quote ${quote.ref} — ${brand}`
    : `Quote ${quote.ref} — ${brand}`

  const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE')}`
  const bodyHtml = [
    emailParagraph(`Hello ${quote.contactPersonName || quote.companyName || 'there'},`),
    hasMessage ? emailParagraph(quote.message!.trim()) : emailParagraph(isUpdate
      ? `Please find the updated quotation for ${quote.companyName || 'your organisation'} below.`
      : `Please find our quotation for ${quote.companyName || 'your organisation'} below.`),
    emailTableHtml(['Item', 'Qty', 'Amount'], quote.lines.map(line => [line.productName, line.qty, kes(line.lineTotal)]), ['l', 'c', 'r']),
    emailTotalsHtml([['Total (incl. VAT)', kes(quote.total)]]),
    emailParagraph(`Valid until ${quote.validUntil || '—'}.${pdfAttached ? ' The full quotation is attached as a PDF.' : ''}`, true),
  ].join('')
  const actions: BrandedAction[] = [
    ...(quote.portalLink ? [{ label: 'View & Respond Online', url: quote.portalLink, tone: 'primary' as const }] : []),
    ...(quote.pdfDownloadUrl ? [{ label: 'Download PDF', url: quote.pdfDownloadUrl, tone: quote.portalLink ? 'secondary' as const : 'primary' as const }] : []),
  ]

  return {
    subject,
    html: brandedEmailHtml({
      title: `Quotation ${quote.ref}`,
      eyebrow: isUpdate ? 'Updated quotation' : 'Quotation',
      preheader: `${isUpdate ? 'Updated quotation' : 'Quotation'} ${quote.ref} · ${kes(quote.total)} · valid until ${quote.validUntil || '—'}`,
      bodyHtml: bodyHtml,
      actions,
      footnote: quote.portalLink ? 'You can accept or decline online — no account needed.' : undefined,
      companyName: brand,
      signatureHtml: emailSignature(['Best regards,', 'Sales', brand, { email: salesEmail }]),
    }),
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
  const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE')}`
  const rfqBody = [
    emailParagraph(`Hello ${rfq.vendorName || 'there'},`),
    rfq.message ? emailParagraph(rfq.message) : '',
    emailParagraph('Please send us your best price, availability, lead time and payment terms for the items below.'),
    rfq.expectedDate ? emailParagraph(`Needed by ${rfq.expectedDate}.`, true) : '',
    emailTableHtml(['#', 'Item', 'Qty', 'Target price', 'Line total'], rfq.lines.map((l, i) => [i + 1, l.productName, l.qty, kes(l.unitPrice), kes(l.subtotal)]), ['c', 'l', 'c', 'r', 'r']),
    emailTotalsHtml([['Subtotal', kes(rfq.subtotal)], ['VAT', kes(rfq.taxTotal)], ['Expected total', kes(rfq.total)]]),
    rfq.notes ? emailParagraph(`Notes: ${rfq.notes}`) : '',
  ].join('')

  return {
    subject: `RFQ ${rfq.ref} from ${rfq.companyName || 'Deed Technologies'}`,
    html: brandedEmailHtml({
      title: `Request for quotation ${rfq.ref}`,
      eyebrow: 'Purchasing',
      preheader: `${rfq.lines.length} item${rfq.lines.length === 1 ? '' : 's'}${rfq.expectedDate ? ` · needed by ${rfq.expectedDate}` : ''}`,
      bodyHtml: rfqBody,
      footnote: 'Reply to this email with your quotation.',
      companyName: rfq.companyName || undefined,
      signatureHtml: emailSignature(['Kind regards,', rfq.senderName || 'Purchasing', rfq.companyName || 'Deed Technologies']),
    }),
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
