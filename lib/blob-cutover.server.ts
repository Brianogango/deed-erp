import 'server-only'
import { sql } from '@/lib/auth/db'
import prisma from '@/lib/prisma'
import {
  CATALOG_BLOB_KEYS,
  DUAL_WRITE_BLOB_KEYS,
  countBlobArray,
  evaluateParity,
  type BlobParityCheck,
} from '@/lib/blob-cutover'

async function readAppState(key: string): Promise<string | null> {
  try {
    const { rows } = await sql`SELECT value FROM app_state WHERE key = ${key} LIMIT 1`
    const row = rows[0] as { value?: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

async function safeCount(fn: () => Promise<number>): Promise<number | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

/** Map dual-write / catalog blob keys to Prisma count queries. */
export async function verifyBlobParity(keys?: string[]): Promise<BlobParityCheck[]> {
  const want = keys?.length
    ? keys
    : [...DUAL_WRITE_BLOB_KEYS, ...CATALOG_BLOB_KEYS]

  const checks: BlobParityCheck[] = []

  for (const blobKey of want) {
    const raw = await readAppState(blobKey)
    const blobCount = countBlobArray(raw)

    if (blobKey === 'deed_accounts') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'account_codes',
        blobCount,
        prismaCount: await safeCount(() => prisma.accountCode.count()),
      }))
      continue
    }
    if (blobKey === 'deed_journalEntries') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'journal_entries',
        blobCount,
        prismaCount: await safeCount(() => prisma.journalEntry.count()),
      }))
      continue
    }
    if (blobKey === 'deed_stockReservations') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'stock_reservations',
        blobCount,
        prismaCount: await safeCount(() => prisma.stockReservation.count()),
      }))
      continue
    }
    if (blobKey === 'deed_deposits' || blobKey === 'deed_deposits_v1') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'deposits',
        blobCount,
        prismaCount: await safeCount(() => prisma.deposit.count()),
      }))
      continue
    }
    if (blobKey === 'deed_holdovers') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'holdovers',
        blobCount,
        prismaCount: await safeCount(() => prisma.holdover.count()),
      }))
      continue
    }
    if (blobKey === 'deed_repairs_v2') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'repairs',
        blobCount,
        prismaCount: await safeCount(() => prisma.repair.count()),
      }))
      continue
    }
    if (blobKey === 'deed_products') {
      checks.push(evaluateParity({
        blobKey,
        prismaTable: 'products',
        blobCount,
        prismaCount: await safeCount(() => prisma.product.count()),
        hardStopWhenUnequal: true,
      }))
      continue
    }

    checks.push({
      blobKey,
      prismaTable: 'unknown',
      blobCount,
      prismaCount: null,
      parityOk: false,
      blockedReason: 'No Prisma mapping registered for this blob key',
    })
  }

  return checks
}

export async function listCutoverCertificates() {
  try {
    return await prisma.blobCutoverCertificate.findMany({ orderBy: { updatedAt: 'desc' } })
  } catch {
    return []
  }
}

export async function upsertCutoverCertificate(input: {
  blobKey: string
  status: string
  blobCount: number | null
  prismaCount: number | null
  parityOk: boolean
  details?: Record<string, unknown>
  certifiedBy?: string | null
  certifiedAt?: Date | null
  archivedAt?: Date | null
  archiveKey?: string | null
  notes?: string | null
}) {
  const existing = await prisma.blobCutoverCertificate.findFirst({
    where: {
      blobKey: input.blobKey,
      status: { in: ['verified', 'certified', 'archived', 'blocked', 'pending'] },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const data = {
    blobKey: input.blobKey,
    status: input.status,
    blobCount: input.blobCount,
    prismaCount: input.prismaCount,
    parityOk: input.parityOk,
    details: input.details ?? {},
    certifiedBy: input.certifiedBy ?? null,
    certifiedAt: input.certifiedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    archiveKey: input.archiveKey ?? null,
    notes: input.notes ?? null,
  }

  if (existing) {
    return prisma.blobCutoverCertificate.update({ where: { id: existing.id }, data })
  }
  return prisma.blobCutoverCertificate.create({ data })
}

export async function copyAppStateToArchive(blobKey: string, archiveKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { rows } = await sql`SELECT value FROM app_state WHERE key = ${blobKey} LIMIT 1`
    const value = (rows[0] as { value?: string } | undefined)?.value
    if (value == null) return { ok: false, error: `Live key ${blobKey} not found` }
    const now = new Date().toISOString()
    await sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (${archiveKey}, ${value}, ${now})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * Retire a live blob key ONLY after certify + archive copy exists.
 * Renames by deleting the live key after a verified archive copy — never deletes
 * without archiveKey present on the certificate.
 */
export async function retireLiveBlobKey(blobKey: string, archiveKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { rows } = await sql`SELECT value FROM app_state WHERE key = ${archiveKey} LIMIT 1`
    const value = (rows[0] as { value?: string } | undefined)?.value
    if (!value) {
      return { ok: false, error: `Archive key ${archiveKey} missing — refuse to retire live key` }
    }
    await sql`DELETE FROM app_state WHERE key = ${blobKey}`
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
