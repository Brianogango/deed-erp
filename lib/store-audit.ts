import 'server-only'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
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
 * Append a server-authored, client-immutable audit entry to the timeline.
 * Actor identity always comes from the server session, never the request
 * body. Callers pass empty arrays for anything not applicable; the entry is
 * skipped entirely when there is nothing to record.
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
  const current = await loadAppState([IMMUTABLE_AUDIT_KEY])
  const existing = Array.isArray(current[IMMUTABLE_AUDIT_KEY]) ? current[IMMUTABLE_AUDIT_KEY] as StoreAuditEntry[] : []
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
  const next = [...existing, entry].slice(-MAX_AUDIT_ROWS)
  await saveStoreKeys({ [IMMUTABLE_AUDIT_KEY]: JSON.stringify(next) })
}
