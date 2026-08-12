/**
 * Normalization helpers for inbound sales email pipeline.
 */

const RE_FW = /^(?:(?:re|fw|fwd|aw|sv|antw|antwort)\s*:\s*)+/i

/** Lowercase trim email; empty → null. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = String(raw || '').trim().toLowerCase()
  if (!e || !e.includes('@')) return null
  return e.slice(0, 150)
}

export function emailLocalPart(email: string | null | undefined): string {
  const e = normalizeEmail(email)
  if (!e) return ''
  return e.split('@')[0] || ''
}

export function emailDomainOf(email: string | null | undefined): string | null {
  const e = normalizeEmail(email)
  if (!e) return null
  return e.split('@')[1] || null
}

/**
 * Canonical E.164-ish for Kenya mobiles when safely possible.
 * Non-Kenyan international numbers keep leading +digits without corruption.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  if (!digits) return null

  // Kenya mobile: 07XXXXXXXX / 01XXXXXXXX / 2547… / 2541…
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`

  // Already international (+… stored without plus in digits)
  if (digits.length >= 10 && digits.length <= 15) {
    if (text.trim().startsWith('+')) return `+${digits}`
    // Ambiguous national without 0 — do not invent country code
    if (digits.startsWith('0')) return null
    return `+${digits}`
  }
  return null
}

/** Comparable last-9 for Kenya match (aligns with portal-verify). */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(raw)
  const digits = (e164 || String(raw || '')).replace(/\D/g, '')
  if (digits.length < 9) return null
  return digits.slice(-9)
}

export function normalizeSubject(raw: string | null | undefined): string {
  return String(raw || '')
    .replace(RE_FW, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Strip quoted reply tails and common signature separators for classification.
 * Original body is preserved separately by the caller.
 */
export function cleanEmailBody(raw: string | null | undefined): string {
  let text = String(raw || '').replace(/\r\n/g, '\n')
  // Cut at classic reply markers
  text = text.split(/\nOn .+ wrote:\s*\n/i)[0] || text
  text = text.split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0] || text
  text = text.split(/\nFrom:\s+.+\nSent:\s+/i)[0] || text
  // Signature delimiters
  text = text.split(/\n-- \n/)[0] || text
  text = text.split(/\n_{5,}\n/)[0] || text
  // Drop quoted lines mostly
  const lines = text.split('\n').filter(line => !/^>/.test(line.trimStart()))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Extract likely phones from signature-ish text. */
export function extractPhonesFromText(text: string): string[] {
  const found: string[] = []
  const re = /(?:\+?254|0)?[17]\d[\d\s-]{7,14}\d/g
  for (const m of text.match(re) || []) {
    const n = normalizePhoneE164(m)
    if (n && !found.includes(n)) found.push(n)
  }
  return found
}

/**
 * Thread key: prefer Gmail-style thrid; else root of References; else Message-ID.
 */
export function resolveThreadId(opts: {
  providerThreadId?: string | null
  inReplyTo?: string | null
  references?: string | null
  messageId: string
}): string {
  const gm = String(opts.providerThreadId || '').trim()
  if (gm) return gm.slice(0, 500)

  const refs = String(opts.references || '')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  if (refs.length > 0) return refs[0].replace(/^<|>$/g, '').slice(0, 500)

  const irt = String(opts.inReplyTo || '').trim().replace(/^<|>$/g, '')
  if (irt) return irt.slice(0, 500)

  return String(opts.messageId || '').replace(/^<|>$/g, '').slice(0, 500)
}
