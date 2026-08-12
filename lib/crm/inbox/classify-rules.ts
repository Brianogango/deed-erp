/**
 * Deterministic sales-intent classifier.
 * Presence of money/currency NEVER implies NEW_SALES_LEAD (Invariant 1).
 * Buying intent can exist without an amount (Invariant 2).
 */

import type { ParsedInboundEmail } from '@/lib/crm/sales-inbox-leads'
import type { SalesInboxPipelineConfig } from '@/lib/crm/inbox/config'
import { cleanEmailBody, emailDomainOf, emailLocalPart, normalizeEmail } from '@/lib/crm/inbox/normalize'
import { isFreeMailDomain } from '@/lib/crm/sales-inbox-leads'

export type SalesIntentClass =
  | 'NEW_SALES_LEAD'
  | 'EXISTING_SALES_THREAD'
  | 'SUPPLIER_OR_PURCHASE'
  | 'PAYMENT_OR_FINANCE'
  | 'SUPPORT_OR_REPAIR'
  | 'INTERNAL'
  | 'MARKETING_OR_NEWSLETTER'
  | 'SPAM_OR_AUTOMATED'
  | 'OTHER'

export interface IntentClassification {
  classification: SalesIntentClass
  confidence: number
  reason: string
  buyingIntent: boolean
  signals: string[]
  requestSummary: string | null
  products: Array<{ description: string; quantity: number | null }>
}

const RFQ =
  /\b(rfq|r\.f\.q|request for (a )?(quote|quotation|proposal)|please quote|kindly quote|send (us )?(a )?quote|quotation for|price (for|of|list)|unit price|how much (for|is|are)|looking (for|to buy)|need(s)? (to )?(buy|purchase|procure)|can you (quote|supply|provide)|do you (have|supply|stock)|availability of|tender|procurement|supply of)\b/i

const PRODUCT =
  /\b(laptop|laptops|notebook|desktop|desktops|computer|computers|printer|printers|server|servers|monitor|monitors|router|switch|firewall|cctv|tablet|macbook|thinkpad|dell|lenovo|hp\b|accessory|accessories|toner|installation|networking)\b/i

const QTY = /\b(\d{1,5})\s*(x|×)?\s*(units?|pcs?|pieces?|laptops?|desktops?|machines?|sets?|qty)?\b/i

const REPAIR =
  /\b(repair|diagnose|screen (crack|broken)|not turning on|warranty claim|service (my|our) (device|laptop|phone))\b/i

const PAYMENT =
  /\b(payment (received|confirmation)|account credited|outstanding balance|invoice\s+[A-Z0-9/-]+|subscription renew)\b/i

const MARKETING = /\b(unsubscribe|save \d+%|limited time|newsletter|webinar|promo)\b/i

const VAGUE = /^(hi|hello|hey|good (morning|afternoon)|please call me|regarding your services).{0,80}$/i

export function classifySalesIntentRules(
  mail: ParsedInboundEmail,
  config: SalesInboxPipelineConfig,
  opts?: { existingThreadLead?: boolean },
): IntentClassification {
  if (opts?.existingThreadLead) {
    return {
      classification: 'EXISTING_SALES_THREAD',
      confidence: 0.99,
      reason: 'Provider thread already linked to an active CRM lead.',
      buyingIntent: false,
      signals: ['existing_thread'],
      requestSummary: null,
      products: [],
    }
  }

  const email = normalizeEmail(mail.fromEmail)
  const domain = emailDomainOf(email)
  const local = emailLocalPart(email)
  const subject = mail.subject || ''
  const body = cleanEmailBody(mail.textBody || '')
  const hay = `${subject}\n${body}`
  const signals: string[] = []

  if (domain && config.internalDomains.has(domain)) {
    return {
      classification: 'INTERNAL',
      confidence: 0.99,
      reason: 'Sender domain is Deed-controlled.',
      buyingIntent: false,
      signals: ['internal_domain'],
      requestSummary: null,
      products: [],
    }
  }

  // Money-only finance language without RFQ → not a lead
  if (PAYMENT.test(hay) && !RFQ.test(hay)) {
    return {
      classification: 'PAYMENT_OR_FINANCE',
      confidence: 0.92,
      reason: 'Payment/finance language without buying intent.',
      buyingIntent: false,
      signals: ['payment_language'],
      requestSummary: null,
      products: [],
    }
  }

  if (MARKETING.test(hay) && !RFQ.test(hay)) {
    return {
      classification: 'MARKETING_OR_NEWSLETTER',
      confidence: 0.9,
      reason: 'Marketing / newsletter signals.',
      buyingIntent: false,
      signals: ['marketing'],
      requestSummary: null,
      products: [],
    }
  }

  if (REPAIR.test(hay) && !RFQ.test(hay) && !PRODUCT.test(hay)) {
    return {
      classification: 'SUPPORT_OR_REPAIR',
      confidence: 0.85,
      reason: 'Repair/support language without procurement RFQ.',
      buyingIntent: false,
      signals: ['repair'],
      requestSummary: null,
      products: [],
    }
  }

  let score = 0
  if (RFQ.test(hay)) {
    score += 0.55
    signals.push('rfq_language')
  }
  if (PRODUCT.test(hay)) {
    score += 0.2
    signals.push('product')
  }
  const qtyMatch = hay.match(QTY)
  let qty: number | null = null
  if (qtyMatch && RFQ.test(hay)) {
    score += 0.15
    signals.push('quantity')
    qty = Number(qtyMatch[1]) || null
  }
  if (local && /^(procurement|purchase|purchasing|rfq|tenders?|buyer|sourcing)$/i.test(local)) {
    score += 0.1
    signals.push('procurement_mailbox')
  }
  if (domain && !isFreeMailDomain(domain) && !config.publicEmailDomains.has(domain)) {
    score += 0.08
    signals.push('corporate_domain')
  }
  if ((mail.attachments ?? []).some(a => /\.(pdf|xlsx?|docx?)$/i.test(a.filename || ''))) {
    score += 0.07
    signals.push('document_attachment')
  }

  const products: IntentClassification['products'] = []
  const prod = hay.match(PRODUCT)
  if (prod && RFQ.test(hay)) {
    products.push({ description: prod[0], quantity: qty })
  }

  if (score >= 0.55 && RFQ.test(hay)) {
    const confidence = Math.min(0.98, 0.7 + score * 0.25)
    const summary = subject.trim() || (products[0]
      ? `Inquiry for ${products[0].description}${qty ? ` × ${qty}` : ''}`
      : 'Sales inquiry')
    return {
      classification: 'NEW_SALES_LEAD',
      confidence,
      reason: `Buying intent signals: ${signals.join(', ')}.`,
      buyingIntent: true,
      signals,
      requestSummary: summary.slice(0, 300),
      products,
    }
  }

  // Vague "call me about services" → low confidence OTHER (review band)
  if (VAGUE.test(body.slice(0, 120)) || VAGUE.test(subject)) {
    return {
      classification: 'OTHER',
      confidence: 0.55,
      reason: 'Vague inquiry without clear procurement requirement.',
      buyingIntent: false,
      signals: ['vague'],
      requestSummary: null,
      products: [],
    }
  }

  // Amounts alone must not create leads
  if (/[\$€£]|ksh|kes|\bUSD\b|\d{1,3}(,\d{3})+/i.test(hay) && !RFQ.test(hay)) {
    return {
      classification: 'OTHER',
      confidence: 0.7,
      reason: 'Contains amounts/currency without buying intent.',
      buyingIntent: false,
      signals: ['amount_without_intent'],
      requestSummary: null,
      products: [],
    }
  }

  return {
    classification: 'OTHER',
    confidence: 0.4,
    reason: 'No clear sales buying intent.',
    buyingIntent: false,
    signals,
    requestSummary: null,
    products: [],
  }
}
