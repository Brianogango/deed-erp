/**
 * Sales@ → CRM relevance gate.
 *
 * Disposition:
 * - skip   — hard junk / noise (never create a lead)
 * - review — unclear value → create as needs_review, no assign/notify
 * - accept — RFQ-shaped → create as new, auto-assign + notify
 */



/** Local-parts that almost never write real RFQs. */
const DEFAULT_BLOCK_LOCALS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'newsletter', 'news', 'marketing', 'promo', 'promotions',
  'notifications', 'notification', 'alerts', 'bounce', 'bounces',
  'support+noreply', 'updates', 'digest',
]

/** Domains that are typically bulk / vendor blast sources. Extend via env. */
const DEFAULT_BLOCK_DOMAINS = [
  'mailchimp.com', 'mailchimpapp.net', 'sendgrid.net', 'sendgrid.com',
  'constantcontact.com', 'cmail19.com', 'mailgun.org', 'amazonses.com',
]







export function parseCsvLowerSet(raw: string | undefined | null): Set<string> {
  const out = new Set<string>()
  for (const part of String(raw || '').split(/[,;\s]+/)) {
    const v = part.trim().toLowerCase()
    if (v) out.add(v)
  }
  return out
}

export function resolveInboxBlocklists(env: NodeJS.ProcessEnv = process.env): {
  blockLocals: Set<string>
  blockDomains: Set<string>
} {
  const blockLocals = new Set([
    ...DEFAULT_BLOCK_LOCALS,
    ...parseCsvLowerSet(env.SALES_INBOX_BLOCK_LOCALS),
  ])
  const blockDomains = new Set([
    ...DEFAULT_BLOCK_DOMAINS,
    ...parseCsvLowerSet(env.SALES_INBOX_BLOCK_DOMAINS),
  ])
  return { blockLocals, blockDomains }
}



