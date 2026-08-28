/**
 * Canonical ERP search normalization.
 *
 * Search should behave the same across modules: case-insensitive, accent-insensitive,
 * whitespace tolerant and forgiving of punctuation used in refs/serials/phone numbers.
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function searchTokens(query: unknown): string[] {
  const normalized = normalizeSearchText(query)
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

/** Every query token must appear somewhere in the combined searchable values. */
export function matchesSearch(query: unknown, ...values: unknown[]): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const haystack = normalizeSearchText(values.flatMap(value => Array.isArray(value) ? value : [value]).join(' '))
  return tokens.every(token => haystack.includes(token))
}

export function searchIncludes(value: unknown, query: unknown): boolean {
  return matchesSearch(query, value)
}
