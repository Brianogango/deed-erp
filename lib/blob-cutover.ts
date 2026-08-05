/**
 * Gated blob cutover — verify → certify → archive (never blind-delete).
 *
 * Absolute rule: never DELETE live `deed_*` app_state keys without a parity
 * certificate. Products blob vs Prisma gap is a hard stop for product cutover.
 *
 * Domain roles (AGENT-DB-002 / DB-001 follow-up):
 *  - dual_write: expect blob count ≈ Prisma count (certify when equal)
 *  - catalog:    relational-first catalogs; hard-stop when unequal
 *  - blob_sot:   blob is operational SoT; Prisma may lag (track coverage, do not
 *                certify for retirement until counts converge)
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

/**
 * Domains still blob-SoT or partial Prisma mirrors — tracked for soak/parity
 * reporting (not required for admin-reset certification gate).
 */
export const EXTENDED_CUTOVER_BLOB_KEYS = [
  'deed_purchaseOrders',
  'deed_payments',
  'deed_stockMoves',
  'deed_invoices',
  'deed_saleOrders',
  'deed_quotes',
  'deed_serials',
  'deed_deliveries',
  'deed_receipts',
] as const

/** Keys where blob remains the operational source of truth today. */
export const BLOB_SOT_KEYS = [
  'deed_purchaseOrders',
  'deed_stockMoves',
  'deed_serials',
  'deed_deliveries',
  'deed_receipts',
] as const

export type CutoverBlobKey = (typeof DUAL_WRITE_BLOB_KEYS)[number] | (typeof CATALOG_BLOB_KEYS)[number] | string

export type CutoverDomainRole = 'dual_write' | 'catalog' | 'blob_sot'

export type CutoverStatus = 'pending' | 'verified' | 'certified' | 'archived' | 'blocked' | 'tracked'

export interface BlobParityCheck {
  blobKey: string
  prismaTable: string
  blobCount: number | null
  prismaCount: number | null
  parityOk: boolean
  /** dual_write | catalog | blob_sot — drives certify eligibility */
  domainRole?: CutoverDomainRole
  /** prismaCount / blobCount when both known (0–1+) */
  mirrorCoverage?: number | null
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

export function domainRoleFor(blobKey: string): CutoverDomainRole {
  if ((CATALOG_BLOB_KEYS as readonly string[]).includes(blobKey)) return 'catalog'
  if ((BLOB_SOT_KEYS as readonly string[]).includes(blobKey)) return 'blob_sot'
  return 'dual_write'
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

/** Extract string ids from a JSON array blob (best-effort). */
export function extractBlobIds(raw: string | null | undefined, limit = 500): string[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = JSON.parse(raw)
    const rows = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [])
    const ids: string[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const id = (row as { id?: unknown }).id
      if (typeof id === 'string' && id) ids.push(id)
      if (ids.length >= limit) break
    }
    return ids
  } catch {
    return []
  }
}

export function evaluateParity(opts: {
  blobKey: string
  prismaTable: string
  blobCount: number | null
  prismaCount: number | null
  domainRole?: CutoverDomainRole
  /** Allow prisma >= blob when blob is a known subset (rare). Default: exact match. */
  allowPrismaAhead?: boolean
  hardStopWhenUnequal?: boolean
  /** Optional deep-check: how many sampled blob ids exist in Prisma. */
  idOverlap?: { sampled: number; matched: number }
}): BlobParityCheck {
  const domainRole = opts.domainRole ?? domainRoleFor(opts.blobKey)
  const { blobKey, prismaTable, blobCount, prismaCount } = opts

  const mirrorCoverage =
    blobCount != null && prismaCount != null && blobCount > 0
      ? Number((prismaCount / blobCount).toFixed(4))
      : blobCount === 0 && prismaCount === 0
        ? 1
        : null

  const base = {
    blobKey,
    prismaTable,
    blobCount,
    prismaCount,
    domainRole,
    mirrorCoverage,
    details: opts.idOverlap
      ? {
          idOverlap: opts.idOverlap,
          idOverlapPct: opts.idOverlap.sampled
            ? Number((opts.idOverlap.matched / opts.idOverlap.sampled).toFixed(4))
            : null,
        }
      : undefined,
  }

  if (blobCount == null && prismaCount == null) {
    return {
      ...base,
      parityOk: false,
      blockedReason: 'Neither blob nor Prisma count available',
    }
  }
  if (blobCount == null) {
    return {
      ...base,
      parityOk: false,
      blockedReason: 'Blob key missing or unreadable — cannot certify cutover',
    }
  }
  if (prismaCount == null) {
    return {
      ...base,
      parityOk: false,
      blockedReason: 'Prisma table count unavailable',
    }
  }

  // Blob-SoT domains: Prisma may lag. Track coverage; only fail hard if Prisma is
  // mysteriously ahead of the blob (suggests orphan relational rows).
  if (domainRole === 'blob_sot') {
    if (prismaCount > blobCount) {
      return {
        ...base,
        parityOk: false,
        blockedReason: `Prisma ahead of blob-SoT (${prismaCount} > ${blobCount}) — investigate orphans`,
        details: { ...(base.details || {}), gap: blobCount - prismaCount },
      }
    }
    const equal = blobCount === prismaCount
    return {
      ...base,
      parityOk: equal,
      blockedReason: equal
        ? undefined
        : `Blob-SoT mirror lag: blob ${blobCount} vs Prisma ${prismaCount} (coverage ${mirrorCoverage})`,
      details: { ...(base.details || {}), gap: blobCount - prismaCount, tracked: true },
    }
  }

  const equal = blobCount === prismaCount
  const prismaAheadOk = !!opts.allowPrismaAhead && prismaCount >= blobCount
  const parityOk = equal || prismaAheadOk

  if (!parityOk && (opts.hardStopWhenUnequal || domainRole === 'catalog' || blobKey === 'deed_products')) {
    return {
      ...base,
      parityOk: false,
      blockedReason: `Hard stop: blob ${blobCount} ≠ Prisma ${prismaCount}. Soak/parity required before any archive or delete.`,
      details: { ...(base.details || {}), gap: blobCount - prismaCount },
    }
  }

  return {
    ...base,
    parityOk,
    blockedReason: parityOk ? undefined : `Count mismatch: blob ${blobCount} vs Prisma ${prismaCount}`,
    details: parityOk ? base.details : { ...(base.details || {}), gap: blobCount - prismaCount },
  }
}

/** Certify only keys that fully match — never blob_sot lag. */
export function canCertify(check: BlobParityCheck): boolean {
  if (check.domainRole === 'blob_sot' && check.blobCount !== check.prismaCount) return false
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

/** Summarise a parity report for ops dashboards / cron exit codes. */
export function summariseParityChecks(checks: BlobParityCheck[]) {
  const failed = checks.filter(c => !c.parityOk)
  const hardStops = failed.filter(c => c.domainRole === 'catalog' || /Hard stop/i.test(c.blockedReason || ''))
  const blobSotLag = failed.filter(c => c.domainRole === 'blob_sot')
  const dualWriteGaps = failed.filter(c => c.domainRole === 'dual_write')
  return {
    total: checks.length,
    ok: checks.length - failed.length,
    failed: failed.length,
    hardStops: hardStops.length,
    blobSotLag: blobSotLag.length,
    dualWriteGaps: dualWriteGaps.length,
    /** Non-zero exit recommended when hardStops or dual_write gaps exist. */
    unhealthy: hardStops.length + dualWriteGaps.length > 0,
  }
}
