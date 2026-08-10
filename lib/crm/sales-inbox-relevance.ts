/**
 * Sales@ → CRM relevance gate.
 *
 * Disposition:
 * - skip   — hard junk / noise (never create a lead)
 * - review — unclear value → create as needs_review, no assign/notify
 * - accept — RFQ-shaped → create as new, auto-assign + notify
 */

import type { ParsedInboundEmail } from '@/lib/crm/sales-inbox-leads'
import { isFreeMailDomain, shouldSkipInboundEmail } from '@/lib/crm/sales-inbox-leads'

export type InboundDisposition =
  | { action: 'skip'; reason: string }
  | { action: 'review'; reason: string; score: number; signals: string[] }
  | { action: 'accept'; reason: string; score: number; signals: string[] }

/** Local-parts that almost never write real RFQs. */
export const DEFAULT_BLOCK_LOCALS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'newsletter', 'news', 'marketing', 'promo', 'promotions',
  'notifications', 'notification', 'alerts', 'bounce', 'bounces',
  'support+noreply', 'updates', 'digest',
]

/** Domains that are typically bulk / vendor blast sources. Extend via env. */
export const DEFAULT_BLOCK_DOMAINS = [
  'mailchimp.com', 'mailchimpapp.net', 'sendgrid.net', 'sendgrid.com',
  'constantcontact.com', 'cmail19.com', 'mailgun.org', 'amazonses.com',
]

const PROMO_SUBJECT =
  /\b(unsubscribe|webinar|seo\b|digital marketing|grow your (business|sales)|limited time|act now|congratulations you|you('ve| have) won|crypto|forex|loan approval|casino|betting|nigerian prince|dear beneficiary)\b/i

const RFQ_SUBJECT_OR_BODY =
  /\b(rfq|r\.f\.q|request for (a )?quote|quotation|quote|tender|procurement|purchase order|\bpo\b|proforma|pro-forma|invoice request|supply of|looking (for|to buy)|need(s)? (a |an |to )?(quote|quotation|price)|kindly quote|please quote|price list|availability|how much|unit price|lpo)\b/i

const PRODUCT_SIGNAL =
  /\b(laptop|laptops|notebook|desktop|desktops|computer|computers|pc\b|pcs\b|printer|printers|server|servers|monitor|monitors|ram\b|ssd|hdd|router|switch|firewall|cctv|pos\b|tablet|iphone|macbook|dell|hp\b|lenovo|thinkpad|accessory|accessories|toner|cartridge)\b/i

const QTY_SIGNAL = /\b\d{1,5}\s*(x|×)?\s*(units?|pcs?|pieces?|laptops?|desktops?|machines?|sets?|qty)\b/i

const PROCUREMENT_LOCAL =
  /^(info|sales|procurement|purchase|purchasing|rfq|enquiry|inquiry|tenders?|supplies|buyer|sourcing)$/i

const ACCEPT_SCORE = 2

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

function haystack(mail: ParsedInboundEmail): string {
  return `${mail.subject || ''}\n${mail.textBody || ''}`
}

function hasUsefulAttachment(mail: ParsedInboundEmail): boolean {
  return (mail.attachments ?? []).some(a => {
    const name = (a.filename || '').toLowerCase()
    const type = (a.contentType || '').toLowerCase()
    if (!name && !type) return false
    if (/\.(pdf|xlsx?|docx?|csv|txt)$/i.test(name)) return true
    if (/pdf|sheet|excel|word|csv|msword|officedocument/.test(type)) return true
    return (a.size || 0) >= 8_000
  })
}

/**
 * Classify one inbound message for CRM import.
 * Pure — safe for unit tests.
 */
export function classifyInboundEmail(
  mail: ParsedInboundEmail,
  opts?: {
    blockLocals?: Iterable<string>
    blockDomains?: Iterable<string>
    acceptScore?: number
  },
): InboundDisposition {
  const noise = shouldSkipInboundEmail(mail)
  if (noise.skip) return { action: 'skip', reason: noise.reason }

  const email = (mail.fromEmail || '').trim().toLowerCase()
  const local = email.split('@')[0] || ''
  const domain = email.split('@')[1] || ''

  const blockLocals = new Set(
    [...(opts?.blockLocals ?? DEFAULT_BLOCK_LOCALS)].map(s => String(s).toLowerCase()),
  )
  const blockDomains = new Set(
    [...(opts?.blockDomains ?? DEFAULT_BLOCK_DOMAINS)].map(s => String(s).toLowerCase()),
  )

  if (blockLocals.has(local) || [...blockLocals].some(b => local === b || local.startsWith(`${b}+`))) {
    return { action: 'skip', reason: 'blocked_local' }
  }
  if (domain && (blockDomains.has(domain) || [...blockDomains].some(b => domain === b || domain.endsWith(`.${b}`)))) {
    return { action: 'skip', reason: 'blocked_domain' }
  }

  const subject = mail.subject || ''
  if (PROMO_SUBJECT.test(subject) || PROMO_SUBJECT.test(mail.textBody || '')) {
    return { action: 'skip', reason: 'promo_content' }
  }

  const text = haystack(mail)
  const signals: string[] = []
  let score = 0

  if (RFQ_SUBJECT_OR_BODY.test(text)) {
    score += 2
    signals.push('rfq_language')
  }
  if (PRODUCT_SIGNAL.test(text)) {
    score += 1
    signals.push('product_mention')
  }
  if (QTY_SIGNAL.test(text)) {
    score += 1
    signals.push('quantity')
  }
  if (PROCUREMENT_LOCAL.test(local)) {
    score += 1
    signals.push('procurement_mailbox')
  }
  if (domain && !isFreeMailDomain(domain)) {
    score += 1
    signals.push('corporate_domain')
  }
  if (hasUsefulAttachment(mail)) {
    score += 1
    signals.push('business_attachment')
  }

  const bodyLen = (mail.textBody || '').replace(/\s+/g, ' ').trim().length
  if (bodyLen >= 80) {
    score += 1
    signals.push('substantive_body')
  }

  const threshold = opts?.acceptScore ?? ACCEPT_SCORE
  if (score >= threshold) {
    return {
      action: 'accept',
      reason: signals[0] || 'rfq_signals',
      score,
      signals,
    }
  }

  return {
    action: 'review',
    reason: signals.length ? 'weak_signals' : 'no_rfq_signals',
    score,
    signals,
  }
}

export function triageNoteLine(disposition: Exclude<InboundDisposition, { action: 'skip' }>): string {
  const sig = disposition.signals.length ? disposition.signals.join(', ') : 'none'
  if (disposition.action === 'accept') {
    return `[Inbox triage: accepted · score ${disposition.score} · ${sig}]`
  }
  return `[Inbox triage: needs review · score ${disposition.score} · ${sig} · ${disposition.reason}]`
}
