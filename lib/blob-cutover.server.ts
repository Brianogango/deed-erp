import 'server-only'
import { sql } from '@/lib/auth/db'
import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  CATALOG_BLOB_KEYS,
  DUAL_WRITE_BLOB_KEYS,
  EXTENDED_CUTOVER_BLOB_KEYS,
  countBlobArray,
  domainRoleFor,
  evaluateParity,
  extractBlobIds,
  type BlobParityCheck,
} from '@/lib/blob-cutover'
import { evaluateJournalDeepParity, extractJournalRefs } from '@/lib/accounting/journal-parity'
import { evaluateJournalRetireReadiness } from '@/lib/accounting/journal-retire-readiness'
import { areJournalWritersMigratedOffBlob } from '@/lib/accounting/journal-writers-flag'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Sample blob ids and count how many exist in a Prisma table by primary key. */
async function sampleIdOverlap(
  raw: string | null,
  existsInPrisma: (ids: string[]) => Promise<number>,
  sampleSize = 100,
): Promise<{ sampled: number; matched: number } | undefined> {
  const ids = extractBlobIds(raw, sampleSize).filter(id => UUID_RE.test(id))
  if (ids.length === 0) return undefined
  try {
    const matched = await existsInPrisma(ids)
    return { sampled: ids.length, matched }
  } catch {
    return { sampled: ids.length, matched: 0 }
  }
}

type Mapping = {
  prismaTable: string
  count: () => Promise<number>
  /** Optional deep ID check against Prisma */
  overlap?: (ids: string[]) => Promise<number>
  allowPrismaAhead?: boolean
  hardStopWhenUnequal?: boolean
}

function mappings(): Record<string, Mapping> {
  return {
    deed_accounts: {
      prismaTable: 'account_codes',
      count: () => prisma.accountCode.count(),
    },
    deed_journalEntries: {
      prismaTable: 'journal_entries',
      count: () => prisma.journalEntry.count(),
      // Engine / STK / FX / reconfig write Prisma-only journals — blob ⊆ Prisma is the gate.
      allowPrismaAhead: true,
    },
    deed_stockReservations: {
      prismaTable: 'stock_reservations',
      count: () => prisma.stockReservation.count(),
    },
    deed_deposits: {
      prismaTable: 'deposits',
      count: () => prisma.deposit.count(),
    },
    deed_deposits_v1: {
      prismaTable: 'deposits',
      count: () => prisma.deposit.count(),
    },
    deed_holdovers: {
      prismaTable: 'holdovers',
      count: () => prisma.holdover.count(),
    },
    deed_repairs_v2: {
      prismaTable: 'repairs',
      count: () => prisma.repair.count(),
      // Repairs use blob ids that may not be UUIDs; overlap only counts UUID-shaped ids.
      overlap: async ids => prisma.repair.count({ where: { id: { in: ids } } }),
      allowPrismaAhead: true,
    },
    deed_products: {
      prismaTable: 'products',
      count: () => prisma.product.count(),
      overlap: async ids => prisma.product.count({ where: { id: { in: ids } } }),
      hardStopWhenUnequal: true,
    },
    deed_purchaseOrders: {
      prismaTable: 'purchase_orders',
      count: () => prisma.purchaseOrder.count(),
    },
    deed_payments: {
      prismaTable: 'payments',
      count: () => prisma.payment.count(),
      overlap: async ids => prisma.payment.count({ where: { id: { in: ids } } }),
    },
    deed_stockMoves: {
      prismaTable: 'stock_movements',
      count: () => prisma.stockMovement.count(),
    },
    deed_invoices: {
      prismaTable: 'invoices',
      count: () => prisma.invoice.count(),
      overlap: async ids => prisma.invoice.count({ where: { id: { in: ids } } }),
    },
    deed_saleOrders: {
      prismaTable: 'sale_orders',
      count: () => prisma.saleOrder.count(),
      overlap: async ids => prisma.saleOrder.count({ where: { id: { in: ids } } }),
    },
    deed_quotes: {
      prismaTable: 'quotes',
      count: () => prisma.quote.count(),
      overlap: async ids => prisma.quote.count({ where: { id: { in: ids } } }),
    },
    deed_serials: {
      prismaTable: 'serial_numbers',
      count: () => prisma.serialNumber.count(),
    },
    deed_deliveries: {
      prismaTable: 'delivery_notes',
      count: () => prisma.deliveryNote.count(),
    },
    // Receipts/GRNs remain blob-only — no parent Prisma model yet.
  }
}

/** Map dual-write / catalog / extended blob keys to Prisma count (+ optional ID overlap). */
export async function verifyBlobParity(keys?: string[]): Promise<BlobParityCheck[]> {
  const want = keys?.length
    ? keys
    : [...DUAL_WRITE_BLOB_KEYS, ...CATALOG_BLOB_KEYS, ...EXTENDED_CUTOVER_BLOB_KEYS]

  const map = mappings()
  const checks: BlobParityCheck[] = []

  for (const blobKey of want) {
    const raw = await readAppState(blobKey)
    const blobCount = countBlobArray(raw)
    const mapping = map[blobKey]

    if (!mapping) {
      checks.push({
        blobKey,
        prismaTable: 'unknown',
        blobCount,
        prismaCount: null,
        parityOk: false,
        domainRole: domainRoleFor(blobKey),
        blockedReason: 'No Prisma mapping registered for this blob key',
      })
      continue
    }

    const prismaCount = await safeCount(mapping.count)
    let idOverlap: { sampled: number; matched: number } | undefined
    if (mapping.overlap) {
      idOverlap = await sampleIdOverlap(raw, mapping.overlap)
    }

    let check = evaluateParity({
      blobKey,
      prismaTable: mapping.prismaTable,
      blobCount,
      prismaCount,
      domainRole: domainRoleFor(blobKey),
      allowPrismaAhead: mapping.allowPrismaAhead,
      hardStopWhenUnequal: mapping.hardStopWhenUnequal,
      idOverlap,
    })

    // Phase 9: journals certify on ref coverage (blob ⊆ Prisma), not count equality alone.
    if (blobKey === 'deed_journalEntries') {
      const deep = await runJournalDeepParity(raw, prismaCount)
      check = {
        ...check,
        parityOk: check.parityOk && deep.ok,
        blockedReason: !deep.ok
          ? deep.blockedReason
          : check.parityOk
            ? undefined
            : check.blockedReason,
        details: {
          ...(check.details || {}),
          journalDeepParity: deep,
          allowPrismaAhead: true,
          identityKey: 'ref',
        },
      }
    }

    checks.push(check)
  }

  return checks
}

/** Director-facing deep journal parity (read-only). */
export async function verifyJournalParityReport() {
  const raw = await readAppState('deed_journalEntries')
  const prismaCount = await safeCount(() => prisma.journalEntry.count())
  const deep = await runJournalDeepParity(raw, prismaCount)
  const certificates = await listCutoverCertificates()
  const journalCert = certificates.find(c => c.blobKey === 'deed_journalEntries') ?? null
  const retireReadiness = evaluateJournalRetireReadiness({
    deepParityOk: deep.ok,
    deepParityReason: deep.blockedReason,
    certificateStatus: journalCert?.status ?? null,
    certificateParityOk: journalCert?.parityOk ?? null,
    archiveKey: journalCert?.archiveKey ?? null,
    // Phase 11: env JOURNAL_WRITERS_MIGRATED=true after dual-write soak + Finance sign-off.
    storeStillBlobWrites: !areJournalWritersMigratedOffBlob(),
    postingEngineEnabled: isAccountingPostingEngineEnabled(),
    writersMigratedOffBlob: areJournalWritersMigratedOffBlob(),
  })
  return {
    blobKey: 'deed_journalEntries',
    prismaTable: 'journal_entries',
    ...deep,
    certificate: journalCert
      ? {
          id: journalCert.id,
          status: journalCert.status,
          parityOk: journalCert.parityOk,
          certifiedAt: journalCert.certifiedAt,
          certifiedBy: journalCert.certifiedBy,
          archiveKey: journalCert.archiveKey,
          notes: journalCert.notes,
        }
      : null,
    retireReadiness,
    note: 'Certify ≠ retire. Prisma-ahead refs (STK/FX/engine) are allowed; every blob ref must exist in Prisma. Retire stays blocked while storeStillBlobWrites=true.',
  }
}

async function runJournalDeepParity(raw: string | null, prismaCount: number | null) {
  const prismaRefRows = await prisma.journalEntry.findMany({
    select: { ref: true },
  }).catch(() => [] as Array<{ ref: string }>)

  const prismaRefs = prismaRefRows.map(r => r.ref)
  const blobRefs = extractJournalRefs(raw)

  // Sample overlapping refs for amount drift (avoid loading every line).
  const prismaRefSet = new Set(prismaRefs)
  const overlapSample = blobRefs.filter(r => prismaRefSet.has(r)).slice(0, 25)
  const prismaTotalsByRef = new Map<string, { debit: number; credit: number }>()
  if (overlapSample.length > 0) {
    const sampleRows = await prisma.journalEntry.findMany({
      where: { ref: { in: overlapSample } },
      select: {
        ref: true,
        lines: { select: { debit: true, credit: true } },
      },
    }).catch(() => [] as Array<{ ref: string; lines: Array<{ debit: unknown; credit: unknown }> }>)
    for (const row of sampleRows) {
      let debit = 0
      let credit = 0
      for (const line of row.lines) {
        debit += Number(line.debit || 0)
        credit += Number(line.credit || 0)
      }
      prismaTotalsByRef.set(row.ref, {
        debit: Math.round(debit * 100) / 100,
        credit: Math.round(credit * 100) / 100,
      })
    }
  }

  return evaluateJournalDeepParity({
    blobRaw: raw,
    prismaRefs,
    prismaTotalsByRef,
    prismaCount: prismaCount ?? prismaRefs.length,
    amountSampleSize: 25,
  })
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
      status: { in: ['verified', 'certified', 'archived', 'blocked', 'pending', 'tracked'] },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const data = {
    blobKey: input.blobKey,
    status: input.status,
    blobCount: input.blobCount,
    prismaCount: input.prismaCount,
    parityOk: input.parityOk,
    details: (input.details ?? {}) as Prisma.InputJsonValue,
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
