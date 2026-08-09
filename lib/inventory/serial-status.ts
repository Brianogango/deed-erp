/**
 * Normalize serial lifecycle status between blob vocabulary and Prisma.
 * Blob historically uses `available`; Prisma SerialNumber uses `in_stock`.
 */

export type BlobSerialStatus =
  | 'available'
  | 'assigned'
  | 'sold'
  | 'returned'
  | 'refurbishment'
  | 'reserved'
  | 'scrap'
  | string

export type PrismaSerialStatus =
  | 'in_stock'
  | 'reserved'
  | 'sold'
  | 'returned'
  | 'refurbishing'
  | 'scrapped'
  | string

/** Statuses that count as free on-hand for allocation / delivery. */
export function isOnHandSerialStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase()
  return s === 'available' || s === 'in_stock'
}

export function blobSerialStatusFromPrisma(status: string | null | undefined): BlobSerialStatus {
  const s = String(status || '').toLowerCase()
  if (s === 'in_stock') return 'available'
  if (s === 'refurbishing') return 'refurbishment'
  if (s === 'scrapped') return 'scrap'
  return s || 'available'
}

export function prismaSerialStatusFromBlob(status: string | null | undefined): PrismaSerialStatus {
  const s = String(status || '').toLowerCase()
  if (s === 'available') return 'in_stock'
  if (s === 'refurbishment') return 'refurbishing'
  if (s === 'scrap') return 'scrapped'
  return s || 'in_stock'
}
