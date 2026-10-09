import type { HRDocument } from '@/lib/store'

export const EXPIRY_WARNING_DAYS = 60

export type DocumentExpiry = { status: 'active' | 'expiring' | 'expired'; daysLeft: number | null }

/** Expiry is derived from the date, not trusted from the stored status (which never changes by itself). */
export function documentExpiry(expiryDate: string | undefined, today: Date = new Date()): DocumentExpiry {
  if (!expiryDate) return { status: 'active', daysLeft: null }
  const end = new Date(`${expiryDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(end.getTime())) return { status: 'active', daysLeft: null }
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const daysLeft = Math.round((end.getTime() - start.getTime()) / 86400000)
  if (daysLeft < 0) return { status: 'expired', daysLeft }
  return { status: daysLeft <= EXPIRY_WARNING_DAYS ? 'expiring' : 'active', daysLeft }
}

export function expiryCounts(docs: Pick<HRDocument, 'expiryDate'>[], today: Date = new Date()) {
  let expiring = 0
  let expired = 0
  for (const d of docs) {
    const s = documentExpiry(d.expiryDate, today).status
    if (s === 'expiring') expiring += 1
    if (s === 'expired') expired += 1
  }
  return { expiring, expired }
}
