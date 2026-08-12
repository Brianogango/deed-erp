/**
 * Deterministic hard exclusions BEFORE AI / sales-intent scoring.
 * Never exclude solely because one keyword (e.g. "invoice") appears —
 * "Please send us an invoice for 20 laptops" must survive.
 */

import type { ParsedInboundEmail } from '@/lib/crm/sales-inbox-leads'
import type { SalesInboxPipelineConfig } from '@/lib/crm/inbox/config'
import { cleanEmailBody, emailDomainOf, emailLocalPart, normalizeEmail } from '@/lib/crm/inbox/normalize'
import { shouldSkipInboundEmail } from '@/lib/crm/sales-inbox-leads'
import { resolveInboxBlocklists } from '@/lib/crm/sales-inbox-relevance'

export type HardExcludeCategory =
  | 'INTERNAL'
  | 'BANK_NOTIFICATION'
  | 'PAYMENT_NOTIFICATION'
  | 'SUPPLIER_DOCUMENT'
  | 'SYSTEM_NOTIFICATION'
  | 'NEWSLETTER'
  | 'MARKETING'
  | 'SPAM'
  | 'OTHER_AUTOMATED'
  | 'BLOCKED_SENDER'

export type HardExcludeResult =
  | { exclude: true; category: HardExcludeCategory; reason: string }
  | { exclude: false }

const BUYING_INTENT_GUARD =
  /\b(please\s+quote|kindly\s+quote|rfq|request for (a )?quote|quotation|looking (for|to buy)|need(s)?\s+\d|supply (of|us)|procurement|tender|how much|unit price|availability of|do you (have|supply)|can you (quote|supply|provide))\b/i

const BANK_SUBJECT =
  /\b(account (credited|debited)|funds? (received|received in)|otp|one[- ]time password|transaction alert|mini statement|balance (alert|notification)|card (transaction|alert))\b/i

const PAYMENT_NO_BUY =
  /\b(payment (has been )?(received|confirmed|successful)|your account has been credited|mpesa (payment|confirmation)|till payment received|outstanding balance is|subscription (will )?renew|invoice\s+[A-Z0-9/-]+\s+(for|amount)|attached invoice)\b/i

const MARKETING =
  /\b(unsubscribe|view in browser|limited time offer|act now|save \d+%|% off|newsletter|webinar|promo code|flash sale)\b/i

const SYSTEM =
  /\b(password reset|verify your (email|account)|security alert|login attempt|delivery status notification|mail delivery failed|undeliverable)\b/i

function senderDomainMatches(domain: string | null, known: Set<string>): boolean {
  if (!domain) return false
  if (known.has(domain)) return true
  for (const k of known) {
    if (domain === k || domain.endsWith(`.${k}`)) return true
  }
  return false
}

/**
 * Hard exclusion. Buying-intent guard wins over payment/invoice keywords.
 */
export function hardExcludeInboundEmail(
  mail: ParsedInboundEmail,
  config: SalesInboxPipelineConfig,
): HardExcludeResult {
  const noise = shouldSkipInboundEmail(mail, {
    internalDomains: [...config.internalDomains],
  })
  if (noise.skip) {
    const cat: HardExcludeCategory =
      noise.reason === 'internal_sender' ? 'INTERNAL'
        : noise.reason === 'list_unsubscribe' ? 'NEWSLETTER'
          : noise.reason === 'auto_submitted' ? 'OTHER_AUTOMATED'
            : 'SYSTEM_NOTIFICATION'
    return { exclude: true, category: cat, reason: noise.reason }
  }

  const email = normalizeEmail(mail.fromEmail)
  const domain = emailDomainOf(email)
  const local = emailLocalPart(email)
  const blocks = resolveInboxBlocklists()

  if (blocks.blockLocals.has(local) || [...blocks.blockLocals].some(b => local === b || local.startsWith(`${b}+`))) {
    return { exclude: true, category: 'BLOCKED_SENDER', reason: 'blocked_local' }
  }
  if (domain && (blocks.blockDomains.has(domain) || [...blocks.blockDomains].some(b => domain === b || domain.endsWith(`.${b}`)))) {
    return { exclude: true, category: 'BLOCKED_SENDER', reason: 'blocked_domain' }
  }
  if (config.knownSystemSenders.has(local)) {
    return { exclude: true, category: 'SYSTEM_NOTIFICATION', reason: 'known_system_local' }
  }

  const subject = mail.subject || ''
  const body = cleanEmailBody(mail.textBody || '')
  const hay = `${subject}\n${body}`

  // Buying intent overrides finance keywords (Invariant 1 + invoice-in-RFQ case).
  if (BUYING_INTENT_GUARD.test(hay)) {
    return { exclude: false }
  }

  if (domain && senderDomainMatches(domain, config.knownBankSenders)) {
    return { exclude: true, category: 'BANK_NOTIFICATION', reason: 'known_bank_sender' }
  }
  if (BANK_SUBJECT.test(subject) || BANK_SUBJECT.test(body)) {
    return { exclude: true, category: 'BANK_NOTIFICATION', reason: 'bank_alert_language' }
  }
  if (PAYMENT_NO_BUY.test(hay)) {
    return { exclude: true, category: 'PAYMENT_NOTIFICATION', reason: 'payment_language_no_buy' }
  }
  if (domain && senderDomainMatches(domain, config.knownSupplierSenders)) {
    // Supplier invoice/PO docs without buying intent → purchase side
    if (/\binvoice\b|\bdelivery note\b|\bgoods received\b|\bproforma\b/i.test(hay)) {
      return { exclude: true, category: 'SUPPLIER_DOCUMENT', reason: 'known_supplier_document' }
    }
  }
  if (MARKETING.test(subject) || (MARKETING.test(body) && /\bunsubscribe\b/i.test(hay))) {
    return { exclude: true, category: 'MARKETING', reason: 'marketing_language' }
  }
  if (SYSTEM.test(subject) || SYSTEM.test(body)) {
    return { exclude: true, category: 'SYSTEM_NOTIFICATION', reason: 'system_language' }
  }

  return { exclude: false }
}
