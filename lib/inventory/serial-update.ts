import type { SerialNumber } from '@/lib/store'

/**
 * Merge a serial PUT/PATCH body onto the current inventory row.
 * Identity edits (serial/barcode/specs) and reservation state
 * (status/saleOrderId/location) must both persist — historically status was
 * dropped, so SO-assigned serials stayed `available` after refresh.
 */
export function mergeSerialUpdate(
  current: SerialNumber,
  body: Partial<SerialNumber> & {
    accessoryNotes?: string
    reason?: string
  },
  identity: {
    serial: string
    barcode?: string
    specs?: string
    conditionNotes?: string
  },
): SerialNumber {
  const next: SerialNumber = {
    ...current,
    serial: identity.serial,
    barcode: identity.barcode || identity.serial,
    specs: identity.specs ?? current.specs,
    accessoryNotes: identity.conditionNotes ?? current.accessoryNotes,
  }

  if (typeof body.status === 'string' && body.status.trim()) {
    next.status = body.status as SerialNumber['status']
  }
  if ('saleOrderId' in body) {
    next.saleOrderId = (body.saleOrderId as string | undefined) || undefined
  }
  if ('repairId' in body) {
    next.repairId = (body.repairId as string | undefined) || undefined
  }
  if ('soldDate' in body) {
    next.soldDate = (body.soldDate as string | undefined) || undefined
  }
  if (typeof body.location === 'string' && body.location.trim()) {
    next.location = body.location as SerialNumber['location']
  }

  return next
}
