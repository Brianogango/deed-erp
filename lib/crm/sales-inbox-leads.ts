/**
 * Pure helpers for sales@ inbox → CRM lead conversion.
 */

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
}

export interface DraftLeadFromEmail {
  name: string
  companyName?: string | null
  email: string
  source: 'inbound_email'
  notes: string
  inboundMessageId: string
}

const INTERNAL_DOMAINS = new Set(['deed.co.ke', 'deedcomputers.co.ke'])

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

/** Extract a human name + optional company hint from From header. */
export function parseFromIdentity(fromName: string, fromEmail: string): {
  name: string
  companyName?: string | null
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

  if (!companyName && domain && !INTERNAL_DOMAINS.has(domain) && !/^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail)\./i.test(domain)) {
    const base = domain.split('.')[0]
    if (base && base.length > 2) {
      companyName = base.charAt(0).toUpperCase() + base.slice(1)
    }
  }

  return { name: name.slice(0, 200), companyName: companyName ? companyName.slice(0, 200) : null }
}

export function buildLeadNotesFromEmail(mail: ParsedInboundEmail): string {
  const body = (mail.textBody || '').replace(/\r\n/g, '\n').trim()
  const clipped = body.length > 2500 ? `${body.slice(0, 2500)}\n…` : body
  const lines = [
    `Inbound email to sales@deed.co.ke`,
    `From: ${mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail}`,
    `Subject: ${mail.subject || '(no subject)'}`,
    mail.dateIso ? `Date: ${mail.dateIso}` : null,
    `Message-ID: ${mail.messageId}`,
    '',
    clipped || '(empty body)',
  ].filter(Boolean)
  return lines.join('\n')
}

export function draftLeadFromInboundEmail(mail: ParsedInboundEmail): DraftLeadFromEmail {
  const identity = parseFromIdentity(mail.fromName, mail.fromEmail)
  const subject = (mail.subject || '').trim()
  const notes = buildLeadNotesFromEmail(mail)
  // Prefer a subject-derived label only when From name is a generic local-part
  const name = identity.name
  return {
    name,
    companyName: identity.companyName,
    email: mail.fromEmail.trim().toLowerCase().slice(0, 150),
    source: 'inbound_email',
    notes: subject ? `Re: ${subject}\n\n${notes}` : notes,
    inboundMessageId: mail.messageId.slice(0, 500),
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

export function normalizeMessageId(raw: string | undefined | null, fallbackSeed: string): string {
  const cleaned = String(raw || '').trim().replace(/^<|>$/g, '')
  if (cleaned) return cleaned.slice(0, 500)
  // Synthetic key when Message-ID header is missing
  return `synthetic:${fallbackSeed}`.slice(0, 500)
}
