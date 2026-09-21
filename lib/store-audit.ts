import 'server-only'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import prisma from '@/lib/prisma'
import { archiveDisplacedAuditEntries } from '@/lib/audit-archive'
import type { RejectedPostedInvoiceEdit } from '@/lib/finance-invoice'

export const IMMUTABLE_AUDIT_KEY = 'deed_audit_timeline_v1'
export const MAX_AUDIT_ROWS = 600

export type StoreAuditEntry = {
  id: string
  at: string
  actor: { id: string; username: string; role: string; name?: string }
  source: 'store_sync'
  savedKeys: string[]
  skippedKeys: string[]
  deniedKeys?: string[]
  rejectedPostedInvoiceEdits?: RejectedPostedInvoiceEdit[]
}

/**
 * Append directly into erp_state_records instead of loading, modifying, and
 * re-saving the full 600-entry timeline array. Reduces from ~600 row
 * operations per POST to 1 insert + 1 version bump + occasional trim.
 */
async function appendAuditEntryDirect(entry: StoreAuditEntry): Promise<void> {
  const key = IMMUTABLE_AUDIT_KEY
  let displaced: StoreAuditEntry[] = []

  await prisma.$transaction(async tx => {
    await tx.erpStateKey.upsert({
      where: { key },
      create: { key, kind: 'collection', version: 1 },
      update: { version: { increment: 1 } },
    })

    const maxPos = await tx.erpStateRecord.aggregate({
      where: { key },
      _max: { position: true },
    })

    await tx.erpStateRecord.create({
      data: {
        key,
        recordKey: `id:${entry.id}`,
        position: (maxPos._max.position ?? -1) + 1,
        payload: entry as object,
      },
    })

    const count = await tx.erpStateRecord.count({ where: { key } })
    if (count > MAX_AUDIT_ROWS) {
      const excess = count - MAX_AUDIT_ROWS
      const toRemove = await tx.erpStateRecord.findMany({
        where: { key },
        orderBy: { position: 'asc' },
        take: excess,
        select: { id: true, payload: true },
      })
      if (toRemove.length > 0) {
        displaced = toRemove.map(r => r.payload as unknown as StoreAuditEntry)
        await tx.erpStateRecord.deleteMany({
          where: { id: { in: toRemove.map(r => r.id) } },
        })
      }
    }
  })

  if (displaced.length > 0) {
    await archiveDisplacedAuditEntries(displaced)
  }
}

/**
 * Append a server-authored, client-immutable audit entry to the timeline.
 * Actor identity always comes from the server session, never the request
 * body. Rows displaced by the live 600-row window are archived (P0-SEC-002)
 * instead of being discarded.
 */
export async function appendStoreAudit(
  session: Awaited<ReturnType<typeof getServerSession>>,
  savedKeys: string[],
  skippedKeys: string[],
  deniedKeys: string[] = [],
  rejectedPostedInvoiceEdits: RejectedPostedInvoiceEdit[] = [],
) {
  if (!session) return
  if (savedKeys.length === 0 && skippedKeys.length === 0 && deniedKeys.length === 0 && rejectedPostedInvoiceEdits.length === 0) return
  const entry: StoreAuditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    actor: {
      id: session.user.id,
      username: session.user.username,
      role: session.user.role,
      name: session.user.name || undefined,
    },
    source: 'store_sync',
    savedKeys,
    skippedKeys,
    ...(deniedKeys.length > 0 ? { deniedKeys } : {}),
    ...(rejectedPostedInvoiceEdits.length > 0 ? { rejectedPostedInvoiceEdits } : {}),
  }

  if (process.env.NODE_ENV === 'test') {
    const current = await loadAppState([IMMUTABLE_AUDIT_KEY])
    const existing = Array.isArray(current[IMMUTABLE_AUDIT_KEY]) ? current[IMMUTABLE_AUDIT_KEY] as StoreAuditEntry[] : []
    const combined = [...existing, entry]
    const displaced = combined.length > MAX_AUDIT_ROWS ? combined.slice(0, combined.length - MAX_AUDIT_ROWS) : []
    if (displaced.length > 0) await archiveDisplacedAuditEntries(displaced)
    const next = combined.slice(-MAX_AUDIT_ROWS)
    await saveStoreKeys({ [IMMUTABLE_AUDIT_KEY]: JSON.stringify(next) })
    return
  }

  await appendAuditEntryDirect(entry)
}
