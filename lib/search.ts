/**
 * Shared ERP search normalization.
 * Makes searches consistent for names, references, serials, phones and
 * punctuation-heavy ERP identifiers.
 */
export function normalizeSearchValue(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(normalizeSearchValue).filter(Boolean).join(' ')
  if (value instanceof Date) return value.toISOString()

  let raw = ''
  if (['string','number','boolean','bigint'].includes(typeof value)) {
    raw = String(value)
  } else {
    try {
      raw = Object.values(value as Record<string, unknown>)
        .filter(v => ['string','number','boolean','bigint'].includes(typeof v))
        .map(String)
        .join(' ')
    } catch {}
  }

  const ascii = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const spaced = ascii.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const compact = ascii.replace(/[^a-z0-9]+/g, '')
  return [spaced, compact].filter(Boolean).join(' ')
}

export function tokenizeSearchQuery(query: unknown): string[] {
  return String(query ?? '')
    .trim()
    .split(/\s+/)
    .map(part => part.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean)
}

export function matchesSearchTerms(query: unknown, values: unknown[]): boolean {
  const tokens = tokenizeSearchQuery(query)
  if (!tokens.length) return true
  const haystack = values.map(normalizeSearchValue).filter(Boolean).join(' ')
  return tokens.every(token => haystack.includes(token))
}
