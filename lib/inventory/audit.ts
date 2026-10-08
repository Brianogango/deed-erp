import prisma from '@/lib/prisma'

/**
 * Server-side audit entry for document and stock actions: one row in
 * audit_logs (entity_type 'document', entity_key = the document reference).
 *
 * It used to rewrite the whole deed_auditLogs list (5,000 entries) under a
 * lock for every entry; that copy is frozen and its entries were moved into
 * audit_logs.
 */
export async function appendInventoryAuditLog(entry: {
  action: string
  documentRef: string
  details: string
  userId?: string | null
  username?: string | null
}) {
  const userId = entry.userId && /^[0-9a-f-]{36}$/i.test(entry.userId)
    ? (await prisma.user.findUnique({ where: { id: entry.userId }, select: { id: true } }))?.id ?? null
    : null
  await prisma.auditLog.create({
    data: {
      userId,
      action: String(entry.action).slice(0, 100),
      entityType: 'document',
      entityKey: String(entry.documentRef).slice(0, 120) || null,
      newValues: { details: entry.details, username: entry.username || 'system' },
    },
  })
}
