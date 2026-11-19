/**
 * How a typed search matches a record, for list searches people type into.
 *
 * - Capitals never matter: "kingsun" finds "Kingsun".
 * - Every word typed must appear somewhere, in any order: "limited kingsun"
 *   and "kingsun 0447" both find Kingsun International Limited's INV/2026/0447.
 * - Separators inside document numbers do not matter: "inv 0447",
 *   "inv-2026-0447" and "INV20260447" all find "INV/2026/0447".
 * - Extra spaces around or between words are ignored.
 */

const lower = (value: unknown) => String(value ?? '').toLowerCase()
/** Letters and digits only, so "INV/2026/0447" and "inv-2026-0447" compare equal. */
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]+/gu, '')

export function searchWords(query: unknown): string[] {
  return lower(query).split(/\s+/).map(w => w.trim()).filter(Boolean)
}

export function textMatchesSearch(query: unknown, ...fields: unknown[]): boolean {
  const words = searchWords(query)
  if (!words.length) return true
  const text = fields.map(lower).join(' \u0000 ')
  const squeezed = compact(text)
  return words.every(word => {
    if (text.includes(word)) return true
    const bare = compact(word)
    return bare.length > 0 && squeezed.includes(bare)
  })
}
