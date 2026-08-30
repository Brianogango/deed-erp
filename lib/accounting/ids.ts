import { createHash } from 'crypto'

/** Deterministic UUID from a business key — stable across re-mirrors. */
export function uuidFromKey(namespace: string, key: string): string {
  const h = createHash('md5').update(`${namespace}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Extract leading account code from labels like "1800 - Accounts Receivable". */
export function extractAccountCode(label: string): string | null {
  const m = String(label ?? '').trim().match(/^(\d{3,6})\b/)
  return m ? m[1] : null
}

/** Next source_version for (sourceType, sourceId) so reset-and-repost does not collide. */
export function nextJournalSourceVersion(existingMax: number | null | undefined): number {
  const n = Number(existingMax)
  return Number.isFinite(n) && n > 0 ? n + 1 : 1
}
