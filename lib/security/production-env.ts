import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/
const PLACEHOLDER_RE = /REPLACE_WITH|changeme|password|secret/i
const PRIVILEGED_SECRET_KEYS = [
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  'CUSTOMER_PORTAL_SECRET',
  'INTERNAL_API_SECRET',
  'MFA_ENCRYPTION_KEY',
  'MFA_CHALLENGE_SECRET',
  'CRON_SECRET',
  'NOTIFICATION_WEBHOOK_SECRET',
] as const

export type EnvFieldKind = 'secret' | 'value' | 'flag'
export type EnvCategory =
  | 'Authentication'
  | 'Privileged MFA'
  | 'Database'
  | 'App URL'
  | 'Company'
  | 'Email / SMTP'
  | 'Notifications'
  | 'Integrations'
  | 'M-Pesa'
  | 'Security gate'
  | 'Custom'

export type EnvFieldSpec = {
  key: string
  category: EnvCategory
  kind: EnvFieldKind
  required?: boolean
  generate?: boolean
  readOnly?: boolean
  description: string
}

export const PRODUCTION_ENV_CATALOG: readonly EnvFieldSpec[] = [
  { key: 'AUTH_SECRET', category: 'Authentication', kind: 'secret', required: true, generate: true, description: 'Session signing secret. Keep identical to NEXTAUTH_SECRET.' },
  { key: 'NEXTAUTH_SECRET', category: 'Authentication', kind: 'secret', required: true, generate: true, description: 'NextAuth/JWT signing secret. Rotating signs everyone out.' },
  { key: 'CUSTOMER_PORTAL_SECRET', category: 'Authentication', kind: 'secret', required: true, generate: true, description: 'Customer portal token secret.' },
  { key: 'INTERNAL_API_SECRET', category: 'Authentication', kind: 'secret', required: true, generate: true, description: 'Server-to-server notification/internal API secret.' },
  { key: 'MFA_ENCRYPTION_KEY', category: 'Privileged MFA', kind: 'secret', required: true, generate: true, description: 'Encrypts TOTP secrets. Rotating this forces every privileged user to re-enroll MFA.' },
  { key: 'MFA_CHALLENGE_SECRET', category: 'Privileged MFA', kind: 'secret', required: true, generate: true, description: 'Signs the short-lived MFA challenge cookie.' },
  { key: 'MFA_ENFORCE_PRIVILEGED', category: 'Privileged MFA', kind: 'flag', required: true, description: 'Require authenticator codes for Director, Admin Officer, and Finance Officer.' },
  { key: 'SECURITY_SECRETS_ROTATED_AT', category: 'Security gate', kind: 'value', required: true, description: 'ISO timestamp of the last privileged-secret rotation. Production rejects dates older than 180 days.' },
  { key: 'SETUP_ADMIN_SECRET', category: 'Security gate', kind: 'secret', description: 'Bootstrap-only. Leave empty after the first Director exists.' },
  { key: 'DATABASE_URL', category: 'Database', kind: 'secret', required: true, description: 'PostgreSQL URL for the non-superuser application role.' },
  { key: 'POSTGRES_URL', category: 'Database', kind: 'secret', description: 'Optional alias of DATABASE_URL.' },
  { key: 'REPORTING_DATABASE_URL', category: 'Database', kind: 'secret', description: 'Optional PostgreSQL URL for read-optimised reporting (replica). Falls back to DATABASE_URL.' },
  { key: 'NEXT_PUBLIC_APP_URL', category: 'App URL', kind: 'value', required: true, description: 'Public HTTPS origin. Rebuild is required before the client bundle picks up a change.' },
  { key: 'NEXTAUTH_URL', category: 'App URL', kind: 'value', required: true, description: 'Auth callback origin. Must be https://erp.deed.co.ke in production.' },
  { key: 'NODE_ENV', category: 'App URL', kind: 'flag', readOnly: true, description: 'Process environment. Production deployments must stay on production.' },
  { key: 'PDF_COMPANY_NAME', category: 'Company', kind: 'value', description: 'Company name on PDFs.' },
  { key: 'PDF_COMPANY_ADDRESS', category: 'Company', kind: 'value', description: 'Company address on PDFs.' },
  { key: 'PDF_COMPANY_PHONE', category: 'Company', kind: 'value', description: 'Company phone on PDFs.' },
  { key: 'PDF_COMPANY_EMAIL', category: 'Company', kind: 'value', description: 'Company email on PDFs.' },
  { key: 'PDF_LOGO_URL', category: 'Company', kind: 'value', description: 'Logo path or URL used on PDFs.' },
  { key: 'NEXT_PUBLIC_COMPANY_NAME', category: 'Company', kind: 'value', description: 'Public company name. Rebuild required for the client bundle.' },
  { key: 'NEXT_PUBLIC_COMPANY_ADDRESS', category: 'Company', kind: 'value', description: 'Public company address. Rebuild required for the client bundle.' },
  { key: 'NEXT_PUBLIC_COMPANY_PHONE', category: 'Company', kind: 'value', description: 'Public company phone. Rebuild required for the client bundle.' },
  { key: 'NEXT_PUBLIC_COMPANY_EMAIL', category: 'Company', kind: 'value', description: 'Public company email. Rebuild required for the client bundle.' },
  { key: 'SALES_TEAM_EMAIL', category: 'Email / SMTP', kind: 'value', description: 'Sales team routing address.' },
  { key: 'PROCUREMENT_TEAM_PHONE', category: 'Notifications', kind: 'value', description: 'Procurement WhatsApp/SMS routing number.' },
  { key: 'EMAIL_PROVIDER', category: 'Email / SMTP', kind: 'value', description: 'sendgrid, ses, or smtp.' },
  { key: 'EMAIL_FROM', category: 'Email / SMTP', kind: 'value', description: 'Default From address.' },
  { key: 'SENDGRID_API_KEY', category: 'Email / SMTP', kind: 'secret', generate: false, description: 'SendGrid API key.' },
  { key: 'AWS_SES_REGION', category: 'Email / SMTP', kind: 'value', description: 'AWS SES region.' },
  { key: 'AWS_SES_ACCESS_KEY_ID', category: 'Email / SMTP', kind: 'secret', description: 'AWS SES access key.' },
  { key: 'AWS_SES_SECRET_ACCESS_KEY', category: 'Email / SMTP', kind: 'secret', description: 'AWS SES secret key.' },
  { key: 'SMTP_HOST', category: 'Email / SMTP', kind: 'value', description: 'SMTP hostname.' },
  { key: 'SMTP_PORT', category: 'Email / SMTP', kind: 'value', description: 'SMTP port (587 or 465).' },
  { key: 'SMTP_SECURE', category: 'Email / SMTP', kind: 'flag', description: 'true for SMTPS on 465.' },
  { key: 'SMTP_USER', category: 'Email / SMTP', kind: 'value', description: 'Default SMTP username.' },
  { key: 'SMTP_PASS', category: 'Email / SMTP', kind: 'secret', description: 'Default SMTP password.' },
  { key: 'SMTP_REQUIRE_TLS', category: 'Email / SMTP', kind: 'flag', description: 'Require STARTTLS for SMTP.' },
  { key: 'SMTP_TLS_REJECT_UNAUTHORIZED', category: 'Email / SMTP', kind: 'flag', description: 'Reject invalid SMTP certificates. Must stay true in production.' },
  { key: 'SMTP_TLS_SERVERNAME', category: 'Email / SMTP', kind: 'value', description: 'Optional TLS servername override.' },
  { key: 'SMTP_CONNECTION_TIMEOUT_MS', category: 'Email / SMTP', kind: 'value', description: 'SMTP connection timeout in milliseconds.' },
  { key: 'SMTP_GREETING_TIMEOUT_MS', category: 'Email / SMTP', kind: 'value', description: 'SMTP greeting timeout in milliseconds.' },
  { key: 'SMTP_SOCKET_TIMEOUT_MS', category: 'Email / SMTP', kind: 'value', description: 'SMTP socket timeout in milliseconds.' },
  { key: 'SMTP_MAX_CONNECTIONS', category: 'Email / SMTP', kind: 'value', description: 'Max concurrent SMTP connections.' },
  { key: 'SMTP_MAX_MESSAGES_PER_CONNECTION', category: 'Email / SMTP', kind: 'value', description: 'Messages sent per SMTP connection.' },
  { key: 'SMTP_RATE_DELTA_MS', category: 'Email / SMTP', kind: 'value', description: 'Minimum delay between SMTP messages.' },
  { key: 'SMTP_RATE_LIMIT', category: 'Email / SMTP', kind: 'value', description: 'SMTP messages per second cap.' },
  { key: 'HR_EMAIL', category: 'Email / SMTP', kind: 'value', description: 'HR From address.' },
  { key: 'HR_TEAM_EMAIL', category: 'Email / SMTP', kind: 'value', description: 'Leave-apply To address.' },
  { key: 'LEAVE_APPLY_CC_EMAILS', category: 'Email / SMTP', kind: 'value', description: 'Comma-separated leave-apply CC list.' },
  { key: 'SALES_EMAIL', category: 'Email / SMTP', kind: 'value', description: 'Sales mailbox From/Reply-To.' },
  { key: 'ACCOUNTS_EMAIL', category: 'Email / SMTP', kind: 'value', description: 'Accounts mailbox From/Reply-To.' },
  { key: 'HR_SMTP_USER', category: 'Email / SMTP', kind: 'value', description: 'Dedicated HR SMTP username.' },
  { key: 'HR_SMTP_PASS', category: 'Email / SMTP', kind: 'secret', description: 'Dedicated HR SMTP password.' },
  { key: 'SALES_SMTP_USER', category: 'Email / SMTP', kind: 'value', description: 'Dedicated sales SMTP username.' },
  { key: 'SALES_SMTP_PASS', category: 'Email / SMTP', kind: 'secret', description: 'Dedicated sales SMTP password.' },
  { key: 'SALES_IMAP_HOST', category: 'Email / SMTP', kind: 'value', description: 'Sales inbox IMAP host.' },
  { key: 'SALES_IMAP_PORT', category: 'Email / SMTP', kind: 'value', description: 'Sales inbox IMAP port.' },
  { key: 'SALES_IMAP_USER', category: 'Email / SMTP', kind: 'value', description: 'Sales inbox IMAP username.' },
  { key: 'SALES_IMAP_PASS', category: 'Email / SMTP', kind: 'secret', description: 'Sales inbox IMAP password.' },
  { key: 'ACCOUNTS_SMTP_USER', category: 'Email / SMTP', kind: 'value', description: 'Dedicated accounts SMTP username.' },
  { key: 'ACCOUNTS_SMTP_PASS', category: 'Email / SMTP', kind: 'secret', description: 'Dedicated accounts SMTP password.' },
  { key: 'CRON_SECRET', category: 'Notifications', kind: 'secret', generate: true, description: 'Protects /api/cron/* jobs.' },
  { key: 'VAPID_PUBLIC_KEY', category: 'Notifications', kind: 'value', description: 'Web Push VAPID public key.' },
  { key: 'VAPID_PRIVATE_KEY', category: 'Notifications', kind: 'secret', description: 'Web Push VAPID private key.' },
  { key: 'VAPID_SUBJECT', category: 'Notifications', kind: 'value', description: 'Web Push subject, usually a mailto: address.' },
  { key: 'DEFAULT_PHONE_COUNTRY_CODE', category: 'Notifications', kind: 'value', description: 'Default country code for local phone numbers.' },
  { key: 'WHATSAPP_PHONE_NUMBER_ID', category: 'Notifications', kind: 'value', description: 'Meta WhatsApp phone number id.' },
  { key: 'WHATSAPP_ACCESS_TOKEN', category: 'Notifications', kind: 'secret', description: 'Meta WhatsApp access token.' },
  { key: 'WHATSAPP_BUSINESS_ACCOUNT_ID', category: 'Notifications', kind: 'value', description: 'Meta WhatsApp business account id.' },
  { key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', category: 'Notifications', kind: 'secret', generate: true, description: 'WhatsApp webhook verify token.' },
  { key: 'WHATSAPP_APP_SECRET', category: 'Notifications', kind: 'secret', description: 'WhatsApp app secret for signature checks.' },
  { key: 'WHATSAPP_GRAPH_API_VERSION', category: 'Notifications', kind: 'value', description: 'Graph API version pin.' },
  { key: 'WHATSAPP_HTTP_TIMEOUT_MS', category: 'Notifications', kind: 'value', description: 'WhatsApp HTTP timeout.' },
  { key: 'WHATSAPP_CIRCUIT_FAILURE_THRESHOLD', category: 'Notifications', kind: 'value', description: 'WhatsApp circuit-breaker threshold.' },
  { key: 'WHATSAPP_CIRCUIT_COOLDOWN_MS', category: 'Notifications', kind: 'value', description: 'WhatsApp circuit-breaker cooldown.' },
  { key: 'SMS_PROVIDER', category: 'Notifications', kind: 'value', description: 'telerivet or twilio. Leave empty to pick Telerivet when its API key is set.' },
  { key: 'TELERIVET_API_KEY', category: 'Notifications', kind: 'secret', description: 'Telerivet REST API key from an API client.' },
  { key: 'TELERIVET_PROJECT_ID', category: 'Notifications', kind: 'value', description: 'Telerivet project id (PJ…).' },
  { key: 'TELERIVET_PHONE_ID', category: 'Notifications', kind: 'value', description: 'Telerivet phone/route id (PN…) used to send SMS.' },
  { key: 'TELERIVET_WEBHOOK_SECRET', category: 'Notifications', kind: 'secret', generate: true, description: 'Shared secret for Telerivet status webhooks.' },
  { key: 'TELERIVET_HTTP_TIMEOUT_MS', category: 'Notifications', kind: 'value', description: 'Telerivet HTTP timeout in milliseconds.' },
  { key: 'TWILIO_ACCOUNT_SID', category: 'Notifications', kind: 'value', description: 'Twilio account SID.' },
  { key: 'TWILIO_AUTH_TOKEN', category: 'Notifications', kind: 'secret', description: 'Twilio auth token.' },
  { key: 'TWILIO_PHONE_NUMBER', category: 'Notifications', kind: 'value', description: 'Twilio SMS number.' },
  { key: 'TWILIO_WHATSAPP_NUMBER', category: 'Notifications', kind: 'value', description: 'Twilio WhatsApp number.' },
  { key: 'TWILIO_HTTP_TIMEOUT_MS', category: 'Notifications', kind: 'value', description: 'Twilio HTTP timeout.' },
  { key: 'SMS_MAX_CONCURRENT', category: 'Notifications', kind: 'value', description: 'Max concurrent SMS sends.' },
  { key: 'SMS_MAX_PER_SECOND', category: 'Notifications', kind: 'value', description: 'SMS send rate.' },
  { key: 'NOTIFICATION_BATCH_CONCURRENCY', category: 'Notifications', kind: 'value', description: 'Notification worker concurrency.' },
  { key: 'NOTIFICATIONS_PAUSE_EMAIL_SMS', category: 'Notifications', kind: 'value', description: 'Pause worker email and SMS. Default true. Set false to resume.' },
  { key: 'SENDGRID_WEBHOOK_PUBLIC_KEY', category: 'Notifications', kind: 'value', description: 'SendGrid event webhook public key.' },
  { key: 'NOTIFICATION_WEBHOOK_SECRET', category: 'Notifications', kind: 'secret', generate: true, description: 'Shared-secret fallback for notification webhooks.' },
  { key: 'GOOGLE_CLIENT_ID', category: 'Integrations', kind: 'value', description: 'Google OAuth client id.' },
  { key: 'GOOGLE_CLIENT_SECRET', category: 'Integrations', kind: 'secret', description: 'Google OAuth client secret.' },
  { key: 'GOOGLE_REDIRECT_URI', category: 'Integrations', kind: 'value', description: 'Google OAuth redirect URI.' },
  { key: 'JARVIS_PROVIDER', category: 'Integrations', kind: 'value', description: 'AI provider, usually gemini.' },
  { key: 'GEMINI_API_KEY', category: 'Integrations', kind: 'secret', description: 'Gemini API key.' },
  { key: 'GEMINI_MODEL', category: 'Integrations', kind: 'value', description: 'Gemini model id.' },
  { key: 'ANTHROPIC_API_KEY', category: 'Integrations', kind: 'secret', description: 'Anthropic API key.' },
  { key: 'DEED_WEBSITE_URL', category: 'Integrations', kind: 'value', description: 'Public marketing site URL.' },
  { key: 'UPSTASH_REDIS_REST_URL', category: 'Integrations', kind: 'value', description: 'Upstash Redis REST URL for cache, queues, and distributed rate limits.' },
  { key: 'UPSTASH_REDIS_REST_TOKEN', category: 'Integrations', kind: 'secret', description: 'Upstash Redis REST token.' },
  { key: 'REDIS_URL', category: 'Integrations', kind: 'secret', description: 'Optional redis:// or rediss:// URL for cache and queues. Preferred over Upstash on self-hosted Redis.' },
  { key: 'OBJECT_STORE_DRIVER', category: 'Integrations', kind: 'value', description: 'File object-store driver: fs (default) or s3.' },
  { key: 'OBJECT_STORE_DIR', category: 'Integrations', kind: 'value', description: 'Local object-store root for uploads when driver=fs.' },
  { key: 'BLOB_STORE_DIR', category: 'Integrations', kind: 'value', description: 'Local blob directory for expense/repair/product photos.' },
  { key: 'UPLOADS_DIR', category: 'Integrations', kind: 'value', description: 'Local uploads directory used by the fs object store.' },
  { key: 'OBJECT_STORE_ENDPOINT', category: 'Integrations', kind: 'value', description: 'S3-compatible endpoint (MinIO, Contabo Object Storage, AWS).' },
  { key: 'OBJECT_STORE_REGION', category: 'Integrations', kind: 'value', description: 'S3 region.' },
  { key: 'OBJECT_STORE_BUCKET', category: 'Integrations', kind: 'value', description: 'S3 bucket for ERP files.' },
  { key: 'OBJECT_STORE_PREFIX', category: 'Integrations', kind: 'value', description: 'Key prefix inside the S3 bucket.' },
  { key: 'OBJECT_STORE_ACCESS_KEY_ID', category: 'Integrations', kind: 'secret', description: 'S3 access key id.' },
  { key: 'OBJECT_STORE_SECRET_ACCESS_KEY', category: 'Integrations', kind: 'secret', description: 'S3 secret access key.' },
  { key: 'OBJECT_STORE_FORCE_PATH_STYLE', category: 'Integrations', kind: 'flag', description: 'Use path-style S3 URLs (required for MinIO).' },
  { key: 'REPORT_CACHE_TTL_SECONDS', category: 'Integrations', kind: 'value', description: 'Redis TTL for accounting report cache. Default 60.' },
  { key: 'REPORT_SNAPSHOT_TTL_SECONDS', category: 'Integrations', kind: 'value', description: 'Max age for persisted report snapshots before a live refresh. Default 300.' },
  { key: 'PARTNER_CORS_ORIGINS', category: 'Integrations', kind: 'value', description: 'Comma-separated partner API browser origins.' },
  { key: 'MPESA_ENV', category: 'M-Pesa', kind: 'value', description: 'sandbox or production.' },
  { key: 'MPESA_CONSUMER_KEY', category: 'M-Pesa', kind: 'secret', description: 'Daraja consumer key.' },
  { key: 'MPESA_CONSUMER_SECRET', category: 'M-Pesa', kind: 'secret', description: 'Daraja consumer secret.' },
  { key: 'MPESA_SHORTCODE', category: 'M-Pesa', kind: 'value', description: 'Paybill or till shortcode.' },
  { key: 'MPESA_PASSKEY', category: 'M-Pesa', kind: 'secret', description: 'STK passkey.' },
  { key: 'MPESA_TRANSACTION_TYPE', category: 'M-Pesa', kind: 'value', description: 'CustomerPayBillOnline or CustomerBuyGoodsOnline.' },
  { key: 'MPESA_CALLBACK_URL', category: 'M-Pesa', kind: 'value', description: 'HTTPS STK callback URL.' },
]

const catalogByKey = new Map(PRODUCTION_ENV_CATALOG.map(field => [field.key, field]))

export function isSecretKey(name: string, spec?: EnvFieldSpec): boolean {
  if (spec?.kind === 'secret') return true
  if (spec?.kind === 'value' || spec?.kind === 'flag') return false
  if (name === 'VAPID_PUBLIC_KEY') return false
  if (name === 'DATABASE_URL' || name === 'POSTGRES_URL' || name === 'deed_erp_POSTGRES_URL' || name === 'REPORTING_DATABASE_URL' || name === 'REDIS_URL') return true
  return /(SECRET|PASSWORD|_PASS$|TOKEN|PRIVATE|_KEY$)/i.test(name)
}

export function looksLikePlaceholder(value: string): boolean {
  return Boolean(value) && PLACEHOLDER_RE.test(value)
}

export function generateSecretValue(): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = crypto.randomBytes(48).toString('base64url')
    if (value.length >= 48 && !PLACEHOLDER_RE.test(value)) return value
  }
  throw new Error('Could not generate a non-placeholder secret')
}

export function parseEnvFile(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!ENV_KEY_RE.test(key)) continue
    let value = line.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

export function upsertEnvValues(source: string, updates: Record<string, string>): string {
  let next = source
  for (const [key, value] of Object.entries(updates)) {
    if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid environment key: ${key}`)
    if (value.includes('\n') || value.includes('\r')) throw new Error(`${key} must be a single line`)
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    if (pattern.test(next)) next = next.replace(pattern, line)
    else next = `${next.replace(/\s*$/, '')}\n${line}\n`
  }
  return next.endsWith('\n') ? next : `${next}\n`
}

export type EnvFieldSummary = {
  key: string
  category: EnvCategory
  kind: EnvFieldKind
  required: boolean
  generate: boolean
  readOnly: boolean
  description: string
  present: boolean
  length: number
  placeholder: boolean
  restartRequired: boolean
  value?: string
  database?: { host: string; user: string; name: string }
}

function databaseMeta(value: string): EnvFieldSummary['database'] | undefined {
  try {
    const parsed = new URL(value)
    return {
      host: parsed.hostname,
      user: decodeURIComponent(parsed.username || ''),
      name: decodeURIComponent((parsed.pathname || '/').replace(/^\//, '').split('?')[0] || ''),
    }
  } catch {
    return undefined
  }
}

export function summarizeEnv(values: Record<string, string>): EnvFieldSummary[] {
  const keys = new Set([...PRODUCTION_ENV_CATALOG.map(field => field.key), ...Object.keys(values)])
  const rows: EnvFieldSummary[] = []
  for (const key of keys) {
    if (!ENV_KEY_RE.test(key)) continue
    const spec = catalogByKey.get(key)
    const kind: EnvFieldKind = spec?.kind ?? (isSecretKey(key) ? 'secret' : 'value')
    const raw = values[key] ?? ''
    const secret = kind === 'secret'
    const row: EnvFieldSummary = {
      key,
      category: spec?.category ?? 'Custom',
      kind,
      required: Boolean(spec?.required),
      generate: Boolean(spec?.generate),
      readOnly: Boolean(spec?.readOnly),
      description: spec?.description ?? 'Custom environment variable from the live .env file.',
      present: raw.length > 0,
      length: raw.length,
      placeholder: looksLikePlaceholder(raw),
      restartRequired: secret || key.startsWith('NEXT_PUBLIC_') || key === 'NODE_ENV' || key === 'NEXTAUTH_URL',
    }
    if (!secret) row.value = raw
    if (key === 'DATABASE_URL' || key === 'POSTGRES_URL') row.database = raw ? databaseMeta(raw) : undefined
    rows.push(row)
  }
  const categoryOrder = PRODUCTION_ENV_CATALOG.map(field => field.category).filter((category, index, all) => all.indexOf(category) === index)
  rows.sort((a, b) => {
    const cat = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
    if (cat !== 0) return cat
    return a.key.localeCompare(b.key)
  })
  return rows
}

export function resolveEnvFilePath(): string {
  return process.env.DEED_ENV_FILE || path.join(process.cwd(), '.env')
}

export function readEnvFile(filePath = resolveEnvFilePath()): { path: string; source: string; values: Record<string, string> } {
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error('Environment file is missing'), { status: 404 })
  }
  const source = fs.readFileSync(filePath, 'utf8')
  return { path: filePath, source, values: parseEnvFile(source) }
}

function backupDirFor(_envPath: string): string {
  const preferred = '/var/lib/deed-erp/env-backups'
  try {
    fs.mkdirSync(preferred, { recursive: true, mode: 0o700 })
    fs.accessSync(preferred, fs.constants.W_OK)
    return preferred
  } catch {
    const fallback = path.join(os.tmpdir(), 'deed-erp-env-backups')
    fs.mkdirSync(fallback, { recursive: true, mode: 0o700 })
    return fallback
  }
}

export function writeEnvFile(envPath: string, nextSource: string): { backupPath: string } {
  const stat = fs.existsSync(envPath) ? fs.statSync(envPath) : null
  if (stat && (stat.mode & 0o077) !== 0) {
    throw Object.assign(new Error('Refusing to edit an environment file that is group/world readable. chmod 600 first.'), { status: 409 })
  }
  const backupPath = path.join(
    backupDirFor(envPath),
    `env-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.bak`,
  )
  if (fs.existsSync(envPath)) fs.writeFileSync(backupPath, fs.readFileSync(envPath), { mode: 0o600, flag: 'wx' })
  fs.writeFileSync(envPath, nextSource, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)
  return { backupPath }
}

export function applyEnvUpdates(input: {
  updates?: Record<string, string>
  generate?: string[]
  add?: { key: string; value: string }
  stampRotation?: boolean
}): { nextValues: Record<string, string>; changed: string[] } {
  const current = readEnvFile()
  const nextUpdates: Record<string, string> = { ...(input.updates || {}) }
  const changed = new Set<string>(Object.keys(nextUpdates))

  for (const key of input.generate || []) {
    if (!ENV_KEY_RE.test(key)) throw Object.assign(new Error(`Invalid environment key: ${key}`), { status: 400 })
    const spec = catalogByKey.get(key)
    if (spec?.readOnly) throw Object.assign(new Error(`${key} cannot be generated`), { status: 400 })
    if (!spec?.generate && spec && spec.kind !== 'secret') {
      throw Object.assign(new Error(`${key} is not a generatable secret`), { status: 400 })
    }
    nextUpdates[key] = generateSecretValue()
    changed.add(key)
  }

  if (input.add) {
    const key = input.add.key.trim().toUpperCase()
    if (!ENV_KEY_RE.test(key)) throw Object.assign(new Error('Custom variable names must be UPPER_SNAKE_CASE'), { status: 400 })
    if (catalogByKey.has(key) || current.values[key] !== undefined) {
      throw Object.assign(new Error(`${key} already exists — update it instead of adding it`), { status: 409 })
    }
    nextUpdates[key] = input.add.value
    changed.add(key)
  }

  if (nextUpdates.NODE_ENV) {
    throw Object.assign(new Error('NODE_ENV cannot be changed from Settings'), { status: 400 })
  }
  if (Object.prototype.hasOwnProperty.call(nextUpdates, 'SETUP_ADMIN_SECRET') && String(nextUpdates.SETUP_ADMIN_SECRET || '') && process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('SETUP_ADMIN_SECRET must stay empty after the first Director exists'), { status: 400 })
  }

  if (Object.prototype.hasOwnProperty.call(nextUpdates, 'AUTH_SECRET') && !Object.prototype.hasOwnProperty.call(nextUpdates, 'NEXTAUTH_SECRET')) {
    nextUpdates.NEXTAUTH_SECRET = nextUpdates.AUTH_SECRET
    changed.add('NEXTAUTH_SECRET')
  }
  if (Object.prototype.hasOwnProperty.call(nextUpdates, 'NEXTAUTH_SECRET') && !Object.prototype.hasOwnProperty.call(nextUpdates, 'AUTH_SECRET')) {
    nextUpdates.AUTH_SECRET = nextUpdates.NEXTAUTH_SECRET
    changed.add('AUTH_SECRET')
  }

  const touchesPrivileged = [...changed].some(key => (PRIVILEGED_SECRET_KEYS as readonly string[]).includes(key))
  if (input.stampRotation !== false && (input.stampRotation || touchesPrivileged)) {
    nextUpdates.SECURITY_SECRETS_ROTATED_AT = new Date().toISOString()
    changed.add('SECURITY_SECRETS_ROTATED_AT')
  }

  const nextSource = upsertEnvValues(current.source, nextUpdates)
  writeEnvFile(current.path, nextSource)
  return { nextValues: parseEnvFile(nextSource), changed: [...changed] }
}
