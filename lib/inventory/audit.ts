/**
 * Server-side audit helper for inventory mutations.
 * Appends to deed_auditLogs in the wholesale store (client mirror source).
 */
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export async function appendInventoryAuditLog(entry: {
  action: string
  documentRef: string
  details: string
  userId?: string | null
  username?: string | null
}) {
  const state = await loadAppState(['deed_auditLogs'])
  const logs = Array.isArray(state.deed_auditLogs) ? state.deed_auditLogs as Array<Record<string, unknown>> : []
  const next = [
    {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action: entry.action,
      documentRef: entry.documentRef,
      details: entry.details,
      userId: entry.userId || null,
      username: entry.username || 'system',
      timestamp: new Date().toISOString(),
    },
    ...logs,
  ].slice(0, 5000)
  await saveStoreKeys({ deed_auditLogs: JSON.stringify(next) })
}
