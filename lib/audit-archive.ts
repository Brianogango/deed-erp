import 'server-only'
import prisma from '@/lib/prisma'
import type { StoreAuditEntry } from '@/lib/store-audit'

/**
 * Persist timeline rows that are about to leave the live 600-row window.
 * Failures are logged but do not block store sync (audit archive is best-effort
 * relative to the live write — the live slice still happens).
 */
export async function archiveDisplacedAuditEntries(entries: StoreAuditEntry[]) {
  if (entries.length === 0) return
  try {
    await prisma.storeAuditArchive.createMany({
      data: entries.map(entry => ({
        id: `saa_${entry.id}_${Math.random().toString(36).slice(2, 8)}`,
        entryId: entry.id,
        at: new Date(entry.at),
        actorId: entry.actor?.id ?? null,
        actorName: entry.actor?.name ?? entry.actor?.username ?? null,
        actorRole: entry.actor?.role ?? null,
        payload: entry as object,
      })),
      skipDuplicates: true,
    })
  } catch (err) {
    console.error('[audit-archive] failed to archive displaced timeline rows:', err)
  }
}

export type CombinedAuditRow = {
  id: string
  at: string
  source: 'live' | 'archive'
  actor?: StoreAuditEntry['actor']
  savedKeys?: string[]
  skippedKeys?: string[]
  deniedKeys?: string[]
  rejectedPostedInvoiceEdits?: StoreAuditEntry['rejectedPostedInvoiceEdits']
  payload?: unknown
}

export async function queryCombinedAudit(opts: {
  from?: string | null
  to?: string | null
  q?: string | null
  limit?: number
  offset?: number
}): Promise<{ rows: CombinedAuditRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500)
  const offset = Math.max(opts.offset ?? 0, 0)
  const q = (opts.q ?? '').trim().toLowerCase()

  const archiveWhere: Record<string, unknown> = {}
  if (opts.from || opts.to) {
    archiveWhere.at = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to ? { lte: new Date(opts.to) } : {}),
    }
  }
  if (q) {
    archiveWhere.OR = [
      { actorName: { contains: q, mode: 'insensitive' } },
      { actorRole: { contains: q, mode: 'insensitive' } },
      { entryId: { contains: q, mode: 'insensitive' } },
    ]
  }

  const archived = await prisma.storeAuditArchive.findMany({
    where: archiveWhere,
    orderBy: { at: 'desc' },
    take: 2000,
  })

  const archiveRows: CombinedAuditRow[] = archived.map(row => {
    const payload = row.payload as unknown as StoreAuditEntry
    return {
      id: row.entryId,
      at: row.at.toISOString(),
      source: 'archive' as const,
      actor: payload?.actor ?? {
        id: row.actorId ?? '',
        username: row.actorName ?? '',
        role: row.actorRole ?? '',
        name: row.actorName ?? undefined,
      },
      savedKeys: payload?.savedKeys,
      skippedKeys: payload?.skippedKeys,
      deniedKeys: payload?.deniedKeys,
      rejectedPostedInvoiceEdits: payload?.rejectedPostedInvoiceEdits,
      payload,
    }
  })

  return {
    rows: archiveRows.slice(offset, offset + limit),
    total: archiveRows.length,
  }
}
