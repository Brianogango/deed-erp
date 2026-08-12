/**
 * Central config for sales@ inbound email → CRM pipeline.
 * Env-tunable; no magic numbers scattered through services.
 */

export type InboxPipelineMode = 'shadow' | 'review' | 'auto'

export interface SalesInboxPipelineConfig {
  mode: InboxPipelineMode
  autoCreateEnabled: boolean
  autoCreateThreshold: number
  reviewThreshold: number
  classifierVersion: string
  publicEmailDomains: Set<string>
  internalDomains: Set<string>
  knownBankSenders: Set<string>
  knownSupplierSenders: Set<string>
  knownSystemSenders: Set<string>
  mailbox: string
  provider: 'IMAP'
}

function csvSet(raw: string | undefined, defaults: string[]): Set<string> {
  const out = new Set(defaults.map(s => s.toLowerCase()))
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const v = part.trim().toLowerCase()
    if (v) out.add(v)
  }
  return out
}

const DEFAULT_PUBLIC = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'mail.com', 'ymail.com',
]

const DEFAULT_INTERNAL = ['deed.co.ke', 'deedcomputers.co.ke', 'deed.africa']

const DEFAULT_BANKS = [
  'ncbagroup.com', 'equitybank.co.ke', 'co-opbank.co.ke', 'kcbgroup.com',
  'absa.co.ke', 'standardbank.co.ke', 'stanbic.co.ke', 'dtbk.dtbafrica.com',
]

export function resolveSalesInboxPipelineConfig(
  env: NodeJS.ProcessEnv = process.env,
): SalesInboxPipelineConfig {
  const modeRaw = String(env.SALES_INBOX_MODE || 'auto').trim().toLowerCase()
  const mode: InboxPipelineMode =
    modeRaw === 'shadow' || modeRaw === 'review' || modeRaw === 'auto' ? modeRaw : 'auto'

  const autoCreateThreshold = Math.min(
    1,
    Math.max(0, Number(env.SALES_INBOX_AUTO_CREATE_THRESHOLD ?? 0.9) || 0.9),
  )
  const reviewThreshold = Math.min(
    autoCreateThreshold,
    Math.max(0, Number(env.SALES_INBOX_REVIEW_THRESHOLD ?? 0.75) || 0.75),
  )

  const autoCreateEnabled = !['0', 'false', 'no'].includes(
    String(env.SALES_INBOX_AUTO_CREATE_ENABLED ?? 'true').toLowerCase(),
  )

  return {
    mode,
    autoCreateEnabled: mode === 'auto' && autoCreateEnabled,
    autoCreateThreshold,
    reviewThreshold,
    classifierVersion: String(
      env.SALES_INBOX_CLASSIFIER_VERSION
        || (
          !['0', 'false', 'no', 'off'].includes(String(env.SALES_INBOX_AI_CLASSIFIER ?? 'auto').toLowerCase())
          && Boolean((env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || '').trim())
            ? 'rules+gemini-v3'
            : 'rules-v3'
        ),
    ).trim(),
    publicEmailDomains: csvSet(env.SALES_INBOX_PUBLIC_DOMAINS, DEFAULT_PUBLIC),
    internalDomains: csvSet(env.SALES_INBOX_INTERNAL_DOMAINS, DEFAULT_INTERNAL),
    knownBankSenders: csvSet(env.SALES_INBOX_BANK_SENDERS, DEFAULT_BANKS),
    knownSupplierSenders: csvSet(env.SALES_INBOX_SUPPLIER_SENDERS, []),
    knownSystemSenders: csvSet(env.SALES_INBOX_SYSTEM_SENDERS, [
      'noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster',
    ]),
    mailbox: (env.SALES_IMAP_MAILBOX || 'INBOX').trim() || 'INBOX',
    provider: 'IMAP',
  }
}
