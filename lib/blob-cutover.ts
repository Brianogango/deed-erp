/**
 * Gated blob cutover — verify → certify → archive (never blind-delete).
 *
 * Absolute rule: never DELETE live `deed_*` app_state keys without a parity
 * certificate. Products blob vs Prisma gap is a hard stop for product cutover.
 */

export const DUAL_WRITE_BLOB_KEYS = [
  'deed_accounts',
  'deed_journalEntries',
  'deed_stockReservations',
  'deed_deposits',
  'deed_deposits_v1',
  'deed_holdovers',
  'deed_repairs_v2',
] as const

/** Relational-first catalogs that may still have a legacy blob mirror. */
export const CATALOG_BLOB_KEYS = ['deed_products'] as const

/** Additional domains eligible for gated cutover (not required for admin reset). */
export const EXTENDED_CUTOVER_BLOB_KEYS = [
  'deed_purchaseOrders',
  'deed_payments',
  'deed_stockMoves',
] as const

export type CutoverBlobKey = (typeof DUAL_WRITE_BLOB_KEYS)[number] | (typeof CATALOG_BLOB_KEYS)[number] | string

export type CutoverStatus = 'pending' | 'verified' | 'certified' | 'archived' | 'blocked'

export interface BlobParityCheck {
  blobKey: string
  prismaTable: string
  blobCount: number | null
  prismaCount: number | null
  parityOk: boolean
  blockedReason?: string
  details?: Record<string, unknown>
}

export interface BlobCutoverCertificate {
  id: string
  blobKey: string
  status: CutoverStatus
  blobCount: number | null
  prismaCount: number | null
  parityOk: boolean
  details?: Record<string, unknown>
  certifiedBy?: string | null
  certifiedAt?: string | null
  archivedAt?: string | null
  archiveKey?: string | null
  notes?: string | null
  createdAt?: string
  updatedAt?: string
}

export function archiveKeyFor(blobKey: string, at = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  return `archive:${blobKey}:${stamp}`
}

export function isDualWriteKey(key: string): boolean {
  return (DUAL_WRITE_BLOB_KEYS as readonly string[]).includes(key)
}

export function isProtectedBlobKey(key: string): boolean {
  return isDualWriteKey(key) || (CATALOG_BLOB_KEYS as readonly string[]).includes(key)
}

/** Count array length of a JSON blob value; null if missing/unparseable. */
export function countBlobArray(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: unknown[] }).items.length
    }
    return null
  } catch {
    return null
  }
}

export function evaluateParity(opts: {
  blobKey: string
  prismaTable: string
  blobCount: number | null
  prismaCount: number | null
  /** Allow prisma >= blob when blob is a known subset (rare). Default: exact match. */
  allowPrismaAhead?: boolean
  hardStopWhenUnequal?: boolean
}): BlobParityCheck {
  const { blobKey, prismaTable, blobCount, prismaCount } = opts
  if (blobCount == null && prismaCount == null) {
    return {
      blobKey,
      prismaTable,
      blobCount,
      prismaCount,
      parityOk: false,
      blockedReason: 'Neither blob nor Prisma count available',
    }
  }
  if (blobCount == null) {
    return {
      blobKey,
      prismaTable,
      blobCount,
      prismaCount,
      parityOk: false,
      blockedReason: 'Blob key missing or unreadable — cannot certify cutover',
    }
  }
  if (prismaCount == null) {
    return {
      blobKey,
      prismaTable,
      blobCount,
      prismaCount,
      parityOk: false,
      blockedReason: 'Prisma table count unavailable',
    }
  }

  const equal = blobCount === prismaCount
  const prismaAheadOk = !!opts.allowPrismaAhead && prismaCount >= blobCount
  const parityOk = equal || prismaAheadOk

  if (!parityOk && (opts.hardStopWhenUnequal || blobKey === 'deed_products')) {
    return {
      blobKey,
      prismaTable,
      blobCount,
      prismaCount,
      parityOk: false,
      blockedReason: `Hard stop: blob ${blobCount} ≠ Prisma ${prismaCount}. Soak/parity required before any archive or delete.`,
      details: { gap: blobCount - prismaCount },
    }
  }

  return {
    blobKey,
    prismaTable,
    blobCount,
    prismaCount,
    parityOk,
    blockedReason: parityOk ? undefined : `Count mismatch: blob ${blobCount} vs Prisma ${prismaCount}`,
    details: parityOk ? undefined : { gap: blobCount - prismaCount },
  }
}

export function canCertify(check: BlobParityCheck): boolean {
  return check.parityOk === true
}

export function canArchive(cert: Pick<BlobCutoverCertificate, 'status' | 'parityOk'>): boolean {
  return cert.status === 'certified' && cert.parityOk === true
}

export function canRetireLiveKey(cert: Pick<BlobCutoverCertificate, 'status' | 'parityOk' | 'archiveKey'>): boolean {
  return cert.status === 'archived' && cert.parityOk === true && !!cert.archiveKey
}

/** Keys that must be certified before a full admin reset may wipe app_state. */
export function uncertifiedProtectedKeys(
  certificates: Array<Pick<BlobCutoverCertificate, 'blobKey' | 'status' | 'parityOk'>>,
  keys: readonly string[] = [...DUAL_WRITE_BLOB_KEYS, ...CATALOG_BLOB_KEYS],
): string[] {
  const ok = new Set(
    certificates
      .filter(c => (c.status === 'certified' || c.status === 'archived') && c.parityOk)
      .map(c => c.blobKey),
  )
  return keys.filter(k => !ok.has(k))
}
