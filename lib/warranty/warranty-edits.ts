/**
 * Changes to a warranty after it was issued: bring back one cancelled by
 * mistake, correct its length (a product set up for 6 months that should
 * have been 12), and end the warranties of a sale that was undone. Pure, so
 * the screen and the server apply them the same way.
 */
import { addWarrantyMonths } from '@/lib/warranty-period'

type W = {
  id: string; ref: string; serialId: string; serialNumber?: string
  startDate: string; endDate: string; months: number
  status: 'active' | 'expiring' | 'expired' | 'cancelled'
  cancelledAt?: string; cancelledReason?: string; cancelledByRef?: string
}

export const MAX_WARRANTY_MONTHS = 60

/** Bring back a cancelled warranty. Refused while another warranty on the same machine is open. */
export function restoreWarranty<T extends W>(list: T[], id: string, p: { by: string; now: string; note?: string }): { list: T[]; changed?: T; error?: string } {
  const w = list.find(x => x.id === id)
  if (!w) return { list, error: 'Warranty not found' }
  if (w.status !== 'cancelled') return { list, error: `${w.ref} is not cancelled` }
  const other = list.find(x => x.id !== id && x.serialId === w.serialId && x.status !== 'cancelled')
  if (other) return { list, error: `${w.serialNumber || 'This machine'} already has an open warranty (${other.ref}) — cancel that one first` }
  const changed = {
    ...w,
    status: 'active' as const,
    cancelledAt: undefined, cancelledReason: undefined, cancelledByRef: undefined,
    restoredAt: p.now, restoredBy: p.by,
    restoredFrom: [w.cancelledReason, p.note?.trim()].filter(Boolean).join(' · ') || undefined,
  } as T
  return { list: list.map(x => (x.id === id ? changed : x)), changed }
}

/** Correct a warranty's length; the end date follows from the start date. */
export function changeWarrantyMonths<T extends W>(list: T[], id: string, months: number, p: { by: string; now: string; reason: string }): { list: T[]; changed?: T; error?: string } {
  const w = list.find(x => x.id === id)
  if (!w) return { list, error: 'Warranty not found' }
  if (w.status === 'cancelled') return { list, error: `${w.ref} is cancelled — restore it first` }
  if (!Number.isInteger(months) || months < 1 || months > MAX_WARRANTY_MONTHS) return { list, error: `Enter whole months from 1 to ${MAX_WARRANTY_MONTHS}` }
  if (months === Number(w.months)) return { list, error: `${w.ref} is already ${months} months` }
  const reason = p.reason.trim()
  if (!reason) return { list, error: 'Say why the warranty length changes' }
  const start = String(w.startDate).slice(0, 10)
  const changed = {
    ...w,
    months,
    endDate: addWarrantyMonths(start, months),
    // Expired/expiring are worked out from the dates; a corrected one starts again as active.
    status: 'active' as const,
    lengthChangedAt: p.now, lengthChangedBy: p.by, lengthChangedFrom: Number(w.months), lengthChangeReason: reason,
  } as T
  return { list: list.map(x => (x.id === id ? changed : x)), changed }
}

/** End the open warranties picked out by `ids` because the sale they came from was undone. */
export function cancelWarrantiesForSale<T extends W>(list: T[], ids: Iterable<string>, p: { now: string; reason: string; byRef: string }): { list: T[]; cancelled: T[] } {
  const want = new Set(ids)
  const cancelled: T[] = []
  const next = list.map(w => {
    if (!want.has(w.id) || w.status === 'cancelled') return w
    const c = { ...w, status: 'cancelled' as const, cancelledAt: p.now, cancelledReason: p.reason, cancelledByRef: p.byRef } as T
    cancelled.push(c)
    return c
  })
  return { list: next, cancelled }
}
