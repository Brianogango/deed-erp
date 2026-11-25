export const uid = () => crypto.randomUUID()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUUID = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
export const now = () => new Date().toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}


/**
 * Up to two letters standing in for a name, for an avatar bubble.
 *
 * One letter was not enough to tell people apart: an employee list sorted by
 * name puts "Cynthia Shikoli" directly above "Cynthia Juma", and both bubbles
 * read "C". First and last initial separate them.
 *
 * `fallback` is returned when the source has no letters or digits at all.
 */
export function initials(source: string | null | undefined, fallback = '?'): string {
  const text = String(source ?? '').trim()
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return text.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || fallback
}
