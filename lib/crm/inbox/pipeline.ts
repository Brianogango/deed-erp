/**
 * Pure decision pipeline for one inbound sales email.
 * AI proposes; this module decides CREATE / LINK / REVIEW / IGNORE.
 */

import type { ParsedInboundEmail } from '@/lib/crm/sales-inbox-leads'
import { parseFromIdentity } from '@/lib/crm/sales-inbox-leads'
import {
  resolveSalesInboxPipelineConfig,
  type SalesInboxPipelineConfig,
} from '@/lib/crm/inbox/config'
import { hardExcludeInboundEmail } from '@/lib/crm/inbox/hard-exclude'
import {
  classifySalesIntentRules,
  type IntentClassification,
} from '@/lib/crm/inbox/classify-rules'
import {
  inferCompanyFromDomain,
  resolveContactMatch,
  type ContactCandidate,
  type ContactMatchResult,
} from '@/lib/crm/inbox/contact-resolve'
import {
  cleanEmailBody,
  extractPhonesFromText,
  normalizeEmail,
  normalizeSubject,
  resolveThreadId,
} from '@/lib/crm/inbox/normalize'

export type PipelineDecision =
  | 'ALREADY_PROCESSED'
  | 'HARD_FILTERED'
  | 'LINK_EXISTING_LEAD'
  | 'LEAD_CREATED'
  | 'REVIEW_REQUIRED'
  | 'NON_SALES'
  | 'SHADOW_RECORDED'

export interface ExistingLeadRef {
  id: string
  stage: string
  inboundThreadId?: string | null
  email?: string | null
  name?: string | null
  companyName?: string | null
  clientId?: string | null
}

export interface PipelineInput {
  mail: ParsedInboundEmail
  /** True when provider message id already stored. */
  alreadyProcessed?: boolean
  /** Lead linked to this provider thread (active preferred). */
  threadLead?: ExistingLeadRef | null
  /** Candidate clients for contact resolution. */
  contactCandidates?: ContactCandidate[]
  /** Optional AI classification; invalid/absent → rules only. */
  aiClassification?: IntentClassification | null
  aiFailed?: boolean
  config?: SalesInboxPipelineConfig
}

export interface PipelineResult {
  decision: PipelineDecision
  processingStatus:
    | 'FILTERED'
    | 'CLASSIFIED'
    | 'REVIEW_REQUIRED'
    | 'LINKED_EXISTING_LEAD'
    | 'LEAD_CREATED'
    | 'NON_SALES'
    | 'FAILED'
    | 'RECEIVED'
  classification: IntentClassification | null
  hardFilterReason?: string
  threadId: string
  contact: ContactMatchResult
  companyName: string | null
  leadTitle: string | null
  shouldCreateLead: boolean
  shouldLinkLeadId: string | null
  shouldNotifyAssign: boolean
  processingReason: string
  identity: { name: string; email: string; phone: string | null; companyName: string | null }
}

const CLOSED = new Set(['won', 'lost', 'cancelled', 'converted', 'dead'])

export function decideInboundEmailPipeline(input: PipelineInput): PipelineResult {
  const config = input.config || resolveSalesInboxPipelineConfig()
  const mail = input.mail
  const threadId = resolveThreadId({
    providerThreadId: (mail as any).providerThreadId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    messageId: mail.messageId,
  })

  const identityParsed = parseFromIdentity(mail.fromName, mail.fromEmail)
  const email = normalizeEmail(mail.fromEmail) || ''
  const bodyClean = cleanEmailBody(mail.textBody)
  const phones = extractPhonesFromText(`${mail.textBody || ''}\n${bodyClean}`)
  const phone = phones[0] || null
  const companyName = inferCompanyFromDomain(
    email,
    config,
    identityParsed.companyName,
  )

  const identity = {
    name: identityParsed.name,
    email,
    phone,
    companyName,
  }

  const emptyContact: ContactMatchResult = {
    score: 0,
    matched: null,
    reason: 'skipped',
    band: 'NEW',
    enrich: {},
    conflict: {},
  }

  if (input.alreadyProcessed) {
    return {
      decision: 'ALREADY_PROCESSED',
      processingStatus: 'CLASSIFIED',
      classification: null,
      threadId,
      contact: emptyContact,
      companyName,
      leadTitle: null,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: 'ALREADY_PROCESSED',
      identity,
    }
  }

  const excluded = hardExcludeInboundEmail(mail, config)
  if (excluded.exclude) {
    return {
      decision: 'HARD_FILTERED',
      processingStatus: 'FILTERED',
      classification: {
        classification: excluded.category === 'PAYMENT_NOTIFICATION' || excluded.category === 'BANK_NOTIFICATION'
          ? 'PAYMENT_OR_FINANCE'
          : excluded.category === 'MARKETING' || excluded.category === 'NEWSLETTER'
            ? 'MARKETING_OR_NEWSLETTER'
            : excluded.category === 'INTERNAL'
              ? 'INTERNAL'
              : excluded.category === 'SUPPLIER_DOCUMENT'
                ? 'SUPPLIER_OR_PURCHASE'
                : 'SPAM_OR_AUTOMATED',
        confidence: 0.99,
        reason: excluded.reason,
        buyingIntent: false,
        signals: [excluded.category],
        requestSummary: null,
        products: [],
      },
      hardFilterReason: excluded.reason,
      threadId,
      contact: emptyContact,
      companyName,
      leadTitle: null,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: `HARD_FILTERED:${excluded.category}`,
      identity,
    }
  }

  // Thread resolution before classification (Invariant 5)
  const threadLead = input.threadLead || null
  if (threadLead && !CLOSED.has(String(threadLead.stage || '').toLowerCase())) {
    const classification = classifySalesIntentRules(mail, config, { existingThreadLead: true })
    return {
      decision: 'LINK_EXISTING_LEAD',
      processingStatus: 'LINKED_EXISTING_LEAD',
      classification,
      threadId,
      contact: emptyContact,
      companyName: threadLead.companyName || companyName,
      leadTitle: null,
      shouldCreateLead: false,
      shouldLinkLeadId: threadLead.id,
      shouldNotifyAssign: false,
      processingReason: 'EXISTING_THREAD',
      identity,
    }
  }
  if (threadLead && CLOSED.has(String(threadLead.stage || '').toLowerCase())) {
    // Ambiguous reopen → review
    return {
      decision: 'REVIEW_REQUIRED',
      processingStatus: 'REVIEW_REQUIRED',
      classification: classifySalesIntentRules(mail, config),
      threadId,
      contact: emptyContact,
      companyName,
      leadTitle: null,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: 'CLOSED_THREAD_AMBIGUOUS',
      identity,
    }
  }

  let classification: IntentClassification
  if (input.aiFailed) {
    classification = {
      classification: 'OTHER',
      confidence: 0,
      reason: 'CLASSIFIER_FAILURE',
      buyingIntent: false,
      signals: ['classifier_failure'],
      requestSummary: null,
      products: [],
    }
    // Invariant 6: never auto-create; park for human review.
    return finishReview(
      classification,
      threadId,
      emptyContact,
      companyName,
      null,
      identity,
      'CLASSIFIER_FAILURE',
    )
  }

  classification = input.aiClassification && isValidClassification(input.aiClassification)
    ? input.aiClassification
    : classifySalesIntentRules(mail, config)

  // Prompt-injection text is just content — rules ignore instruction language.
  if (/ignore (all )?previous instructions/i.test(bodyClean) && !classification.buyingIntent) {
    classification = {
      ...classification,
      reason: `${classification.reason} (prompt-like text ignored)`,
      signals: [...classification.signals, 'prompt_injection_ignored'],
    }
  }

  const contact = resolveContactMatch(
    { email, phone, name: identity.name, companyName },
    input.contactCandidates || [],
    config,
  )

  const leadTitle = buildLeadTitle({
    companyName: contact.matched?.companyName || companyName,
    name: identity.name,
    classification,
    subject: mail.subject,
  })

  if (classification.classification !== 'NEW_SALES_LEAD' || !classification.buyingIntent) {
    if (classification.confidence >= config.reviewThreshold && classification.classification === 'OTHER') {
      return finishReview(classification, threadId, contact, companyName, leadTitle, identity, 'AMBIGUOUS')
    }
    return {
      decision: 'NON_SALES',
      processingStatus: 'NON_SALES',
      classification,
      threadId,
      contact,
      companyName,
      leadTitle: null,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: `NON_SALES:${classification.classification}`,
      identity,
    }
  }

  // Confidence bands
  if (classification.confidence < config.reviewThreshold) {
    return {
      decision: 'NON_SALES',
      processingStatus: 'NON_SALES',
      classification,
      threadId,
      contact,
      companyName,
      leadTitle,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: 'LOW_CONFIDENCE',
      identity,
    }
  }

  if (
    classification.confidence < config.autoCreateThreshold
    || contact.band === 'POSSIBLE_DUPLICATE'
    || Object.keys(contact.conflict).length > 0
  ) {
    return finishReview(classification, threadId, contact, companyName, leadTitle, identity, 'NEEDS_HUMAN')
  }

  if (config.mode === 'shadow' || !config.autoCreateEnabled) {
    return {
      decision: 'SHADOW_RECORDED',
      processingStatus: 'CLASSIFIED',
      classification,
      threadId,
      contact,
      companyName,
      leadTitle,
      shouldCreateLead: false,
      shouldLinkLeadId: null,
      shouldNotifyAssign: false,
      processingReason: config.mode === 'shadow' ? 'SHADOW_MODE' : 'AUTO_CREATE_DISABLED',
      identity,
    }
  }

  if (config.mode === 'review') {
    return finishReview(classification, threadId, contact, companyName, leadTitle, identity, 'REVIEW_MODE')
  }

  // Secondary lead resolution: same contact + same normalized subject within notes — caller may pass
  // open leads; here we only create when thread didn't match.
  return {
    decision: 'LEAD_CREATED',
    processingStatus: 'LEAD_CREATED',
    classification,
    threadId,
    contact,
    companyName: contact.matched?.companyName || companyName,
    leadTitle,
    shouldCreateLead: true,
    shouldLinkLeadId: null,
    shouldNotifyAssign: true,
    processingReason: 'AUTO_CREATE',
    identity,
  }
}

function finishReview(
  classification: IntentClassification,
  threadId: string,
  contact: ContactMatchResult,
  companyName: string | null,
  leadTitle: string | null,
  identity: PipelineResult['identity'],
  reason: string,
): PipelineResult {
  return {
    decision: 'REVIEW_REQUIRED',
    processingStatus: 'REVIEW_REQUIRED',
    classification,
    threadId,
    contact,
    companyName,
    leadTitle,
    // Park as needs_review lead so humans see it (Invariant 8)
    shouldCreateLead: true,
    shouldLinkLeadId: null,
    shouldNotifyAssign: false,
    processingReason: reason,
    identity,
  }
}

export function isValidClassification(c: IntentClassification): boolean {
  if (!c || typeof c !== 'object') return false
  if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) return false
  if (typeof c.buyingIntent !== 'boolean') return false
  if (!c.classification) return false
  return true
}

export function buildLeadTitle(opts: {
  companyName?: string | null
  name?: string | null
  classification: IntentClassification
  subject?: string | null
}): string {
  const org = (opts.companyName || opts.name || '').trim()
  const prod = opts.classification.products[0]
  if (org && prod) {
    const qty = prod.quantity ? `${prod.quantity} × ` : ''
    return `${org} — ${qty}${prod.description}`.slice(0, 200)
  }
  if (org && opts.classification.requestSummary) {
    return `${org} — ${opts.classification.requestSummary}`.slice(0, 200)
  }
  const sub = normalizeSubject(opts.subject)
  if (org && sub) return `${org} — ${sub}`.slice(0, 200)
  if (opts.classification.requestSummary) return opts.classification.requestSummary.slice(0, 200)
  if (sub) return sub.slice(0, 200)
  return 'Inbound sales inquiry'
}

export function pipelineAuditNote(result: PipelineResult): string {
  const lines = [
    `[inbox-pipeline ${result.processingReason}]`,
    `decision=${result.decision}`,
    `status=${result.processingStatus}`,
    `thread=${result.threadId}`,
    result.classification
      ? `class=${result.classification.classification} conf=${result.classification.confidence.toFixed(2)} buy=${result.classification.buyingIntent}`
      : 'class=none',
    result.classification?.reason ? `reason=${result.classification.reason}` : '',
    `contact=${result.contact.band} score=${result.contact.score}`,
    result.contact.matched ? `clientId=${result.contact.matched.id}` : 'clientId=none',
  ]
  return lines.filter(Boolean).join('\n')
}
