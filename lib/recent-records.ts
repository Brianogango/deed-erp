/**
 * The last records a person opened — repairs, sale orders, invoices,
 * customers — so the sidebar can take them straight back. Kept in this
 * browser only (it is a convenience, not data).
 */

export type RecentRecord = { href: string; label: string; kind: string; at: number }

export const RECENT_CHANGED_EVENT = 'deed:recent-records'
const LIMIT = 6

const storageKey = (userId: string) => `deed_recent_records_${userId}`

export function readRecentRecords(userId: string | null | undefined): RecentRecord[] {
  if (!userId || typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(r => r && typeof r.href === 'string' && typeof r.label === 'string') : []
  } catch {
    return []
  }
}

/** Newest first, one entry per record, at most six. */
export function withRecentRecord(list: RecentRecord[], entry: Omit<RecentRecord, 'at'>, at = Date.now()): RecentRecord[] {
  return [{ ...entry, at }, ...list.filter(r => r.href !== entry.href)].slice(0, LIMIT)
}

export function rememberRecentRecord(userId: string | null | undefined, entry: Omit<RecentRecord, 'at'>): void {
  if (!userId || typeof window === 'undefined' || !entry.href || !entry.label) return
  try {
    const next = withRecentRecord(readRecentRecords(userId), entry)
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(RECENT_CHANGED_EVENT))
  } catch {
    // Private mode or full storage: recents are a convenience only.
  }
}
