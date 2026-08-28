/**
 * Shared ERP search normalization.
 *
 * Search must behave consistently across desktop/mobile and tolerate common
 * business-reference punctuation (INV/2026/0001, PO-001, phone numbers, etc.).
 */
export function normalizeSearchValue(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(normalizeSearchValue).filter(Boolean).join(' ')
  if (value instanceof Date) return value.toISOString()

  let raw: string
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    raw = String(value)
  } else {
    // Avoid turning React elements / opaque objects into "[object Object]".
    try {
      raw = Object.values(value as Record<string, unknown>)
        .filter(v => ['string', 'number', 'boolean', 'bigint'].includes(typeof v))
        .map(v => String(v))
        .join(' ')
    } catch {
      raw = ''
    }
  }

  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const spaced = ascii
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const compact = ascii.replace(/[^a-z0-9]+/g, '')
  return [spaced, compact].filter(Boolean).join(' ')
}

export function tokenizeSearchQuery(query: unknown): string[] {
  const raw = String(query ?? '').trim()
  if (!raw) return []
  return raw
    .split(/\s+/)
    .map(part => part
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ''),
    )
    .filter(Boolean)
}

/**
 * AND-token search across multiple record values.
 * Every typed token must occur somewhere in the combined record text.
 */
export function matchesSearchTerms(query: unknown, values: unknown[]): boolean {
  const tokens = tokenizeSearchQuery(query)
  if (tokens.length === 0) return true
  const haystack = values.map(normalizeSearchValue).filter(Boolean).join(' ')
  return tokens.every(token => haystack.includes(token))
}
