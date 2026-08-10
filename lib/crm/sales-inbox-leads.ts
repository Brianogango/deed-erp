/**
 * Pure helpers for sales@ inbox → CRM lead conversion.
 */

export interface InboundEmailAttachmentMeta {
  filename: string
  contentType: string
  size: number
  /** Present when parsed from IMAP (Buffer); stripped before DB write. */
  content?: Buffer
  contentBase64?: string
}

export interface ParsedInboundEmail {
  messageId: string
  fromEmail: string
  fromName: string
  subject: string
  textBody: string
  dateIso?: string
  inReplyTo?: string
  references?: string
  autoSubmitted?: string
  listUnsubscribe?: string
  precedence?: string
  attachments?: InboundEmailAttachmentMeta[]
}

export interface DraftLeadFromEmail {
  name: string
  companyName?: string | null
  email: string
  source: 'inbound_email'
  notes: string
  inboundMessageId: string
  emailSubject: string | null
  emailSnippet: string | null
  emailBody: string | null
  emailReceivedAt: string | null
  attachments: Array<{
    filename: string
    contentType: string
    size: number
    content?: Buffer
  }>
}

const INTERNAL_DOMAINS = new Set(['deed.co.ke', 'deedcomputers.co.ke'])

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'mail.com', 'ymail.com',
])

const GENERIC_LOCAL = /^(info|sales|procurement|purchase|purchasing|rfq|enquiry|inquiry|admin|office|contact|hello|support|accounts|billing)$/i

const NOISE_SUBJECT = /^(auto[-\s]?reply|automatic reply|out of office|ooo:|undeliverable|delivery status|mail delivery|read receipt|newsletter|unsubscribe)/i

/** Skip internal mail, auto-replies, newsletters, empty senders. */
export function shouldSkipInboundEmail(mail: ParsedInboundEmail, opts?: {
  internalDomains?: string[]
}): { skip: true; reason: string } | { skip: false } {
  const domains = new Set([
    ...INTERNAL_DOMAINS,
    ...(opts?.internalDomains ?? []).map(d => d.toLowerCase()),
  ])

  const email = (mail.fromEmail || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { skip: true, reason: 'missing_from' }

  const domain = email.split('@')[1] || ''
  if (domains.has(domain)) return { skip: true, reason: 'internal_sender' }

  if (mail.autoSubmitted && mail.autoSubmitted.toLowerCase() !== 'no') {
    return { skip: true, reason: 'auto_submitted' }
  }
  if ((mail.listUnsubscribe || '').trim()) return { skip: true, reason: 'list_unsubscribe' }
  if (/^bulk|junk|list$/i.test(mail.precedence || '')) return { skip: true, reason: 'precedence' }
  if (NOISE_SUBJECT.test(mail.subject || '')) return { skip: true, reason: 'noise_subject' }

  return { skip: false }
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = String(email || '').trim().toLowerCase()
  if (!e.includes('@')) return null
  const domain = e.split('@')[1] || ''
  return domain || null
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false
  const d = domain.toLowerCase()
  if (FREE_MAIL_DOMAINS.has(d)) return true
  return /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail)\./i.test(d)
}

/**
 * Sticky key for org routing:
 * - corporate domain → domain (kijabehospital.org)
 * - free-mail → exact email (same person, not whole gmail)
 * - optional companyName fallback when no usable email domain
 */
export function organizationStickyKey(opts: {
  email?: string | null
  companyName?: string | null
}): string | null {
  const domain = emailDomain(opts.email)
  if (domain && !isFreeMailDomain(domain) && !INTERNAL_DOMAINS.has(domain)) {
    return `domain:${domain}`
  }
  const email = String(opts.email || '').trim().toLowerCase()
  if (email && email.includes('@')) return `email:${email}`
  const company = String(opts.companyName || '').trim().toLowerCase()
  if (company.length >= 2) return `company:${company}`
  return null
}

/** Extract a human name + optional company hint from From header. */
export function parseFromIdentity(fromName: string, fromEmail: string): {
  name: string
  companyName?: string | null
  localPart: string
} {
  const email = fromEmail.trim().toLowerCase()
  const local = email.split('@')[0] || 'Lead'
  const domain = email.split('@')[1] || ''
  const rawName = (fromName || '').trim().replace(/^["']|["']$/g, '')

  let name = rawName
  if (!name) {
    name = local
      .replace(/[._+-]+/g, ' ')
      .replace(/\d+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase()) || 'Inbound lead'
  }

  // "Jane Doe via Company" / "Jane at Acme"
  let companyName: string | null = null
  const via = name.match(/\s+(?:via|at|@)\s+(.+)$/i)
  if (via?.[1]) {
    companyName = via[1].trim()
    name = name.slice(0, via.index).trim() || name
  }

  if (!companyName && domain && !INTERNAL_DOMAINS.has(domain) && !isFreeMailDomain(domain)) {
    const base = domain.split('.')[0]
    if (base && base.length > 2) {
      companyName = base.charAt(0).toUpperCase() + base.slice(1)
    }
  }

  return {
    name: name.slice(0, 200),
    companyName: companyName ? companyName.slice(0, 200) : null,
    localPart: local,
  }
}

export function buildLeadNotesFromEmail(mail: ParsedInboundEmail): string {
  const body = (mail.textBody || '').replace(/\r\n/g, '\n').trim()
  const clipped = body.length > 2500 ? `${body.slice(0, 2500)}\n…` : body
  const attachmentLines = (mail.attachments ?? [])
    .filter(a => a.filename)
    .map(a => `- ${a.filename} (${a.contentType || 'file'}, ${a.size || 0} bytes)`)
  const lines = [
    `Inbound email to sales@deed.co.ke`,
    `From: ${mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail}`,
    `Subject: ${mail.subject || '(no subject)'}`,
    mail.dateIso ? `Date: ${mail.dateIso}` : null,
    `Message-ID: ${mail.messageId}`,
    attachmentLines.length > 0 ? `Attachments (${attachmentLines.length}):` : null,
    ...attachmentLines,
    '',
    clipped || '(empty body)',
  ].filter(v => v != null && v !== false) as string[]
  return lines.join('\n')
}

function snippetFromBody(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean
}

export function draftLeadFromInboundEmail(mail: ParsedInboundEmail): DraftLeadFromEmail {
  const identity = parseFromIdentity(mail.fromName, mail.fromEmail)
  const subject = (mail.subject || '').trim()
  const body = (mail.textBody || '').replace(/\r\n/g, '\n').trim()
  const notes = buildLeadNotesFromEmail(mail)

  let name = identity.name
  // Prefer subject / company when From is a generic mailbox (procurement@, rfq@, …)
  if (GENERIC_LOCAL.test(identity.localPart) || GENERIC_LOCAL.test(name)) {
    if (subject) name = subject.slice(0, 200)
    else if (identity.companyName) name = `${identity.companyName} enquiry`.slice(0, 200)
  }

  const attachments = (mail.attachments ?? [])
    .filter(a => a.filename && (a.content || a.contentBase64) && (a.size ?? 0) > 0)
    .slice(0, 10)
    .map(a => ({
      filename: a.filename.slice(0, 200),
      contentType: (a.contentType || 'application/octet-stream').slice(0, 120),
      size: Math.min(a.size || a.content?.length || 0, 15 * 1024 * 1024),
      content: a.content,
    }))

  return {
    name,
    companyName: identity.companyName,
    email: mail.fromEmail.trim().toLowerCase().slice(0, 150),
    source: 'inbound_email',
    notes: subject ? `Re: ${subject}\n\n${notes}` : notes,
    inboundMessageId: mail.messageId.slice(0, 500),
    emailSubject: subject ? subject.slice(0, 500) : null,
    emailSnippet: snippetFromBody(body).slice(0, 500) || (subject ? subject.slice(0, 500) : null),
    emailBody: body ? body.slice(0, 50_000) : null,
    emailReceivedAt: mail.dateIso ?? null,
    attachments,
  }
}

/**
 * Round-robin: pick the next sales rep after lastOwnerId in a stable sorted list.
 * Falls back to the first rep when lastOwnerId is unknown/missing.
 */
export function pickRoundRobinOwner(
  salesRepIds: string[],
  lastOwnerId?: string | null,
): string | null {
  const ids = [...new Set(salesRepIds.filter(Boolean))]
  if (ids.length === 0) return null
  ids.sort((a, b) => a.localeCompare(b))
  if (!lastOwnerId) return ids[0]
  const idx = ids.indexOf(lastOwnerId)
  if (idx < 0) return ids[0]
  return ids[(idx + 1) % ids.length]
}

/**
 * Among prior leads with an owner, prefer the same organization sticky key.
 * Does not advance round-robin — caller should only update RR when this returns null.
 */
export function pickStickyOwnerFromPriorLeads(
  priorLeads: Array<{ ownerId: string | null; email?: string | null; companyName?: string | null }>,
  draft: { email?: string | null; companyName?: string | null },
  activeSalesRepIds: string[],
): string | null {
  const key = organizationStickyKey(draft)
  if (!key) return null
  const allowed = new Set(activeSalesRepIds)

  for (const lead of priorLeads) {
    if (!lead.ownerId || !allowed.has(lead.ownerId)) continue
    const priorKey = organizationStickyKey({
      email: lead.email,
      companyName: lead.companyName,
    })
    if (priorKey && priorKey === key) return lead.ownerId
  }
  return null
}

export function normalizeMessageId(raw: string | undefined | null, fallbackSeed: string): string {
  const cleaned = String(raw || '').trim().replace(/^<|>$/g, '')
  if (cleaned) return cleaned.slice(0, 500)
  // Synthetic key when Message-ID header is missing
  return `synthetic:${fallbackSeed}`.slice(0, 500)
}

/**
 * Best-effort hydrate for older inbound leads that only stored a notes blob.
 */
export function hydrateEmailContextFromNotes(notes: string | null | undefined): {
  emailSubject: string | null
  emailSnippet: string | null
  emailBody: string | null
} {
  const raw = String(notes || '')
  if (!raw.trim()) {
    return { emailSubject: null, emailSnippet: null, emailBody: null }
  }
  const subject =
    raw.match(/^Re:\s*(.+)$/m)?.[1]?.trim()
    || raw.match(/^Subject:\s*(.+)$/m)?.[1]?.trim()
    || null
  // Body is usually after the blank line following headers
  const parts = raw.split(/\n\n/)
  const body = parts.length > 1 ? parts.slice(1).join('\n\n').trim() : raw.trim()
  const snippet = body.replace(/\s+/g, ' ').trim()
  return {
    emailSubject: subject ? subject.slice(0, 500) : null,
    emailSnippet: snippet ? (snippet.length > 240 ? `${snippet.slice(0, 240)}…` : snippet).slice(0, 500) : null,
    emailBody: body ? body.slice(0, 50_000) : null,
  }
}
