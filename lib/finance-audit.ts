import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isUUID } from '@/lib/utils'

export type FinancialAuditInput = {
  userId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  oldValues?: unknown
  newValues?: unknown
  ipAddress?: string | null
  requestId?: string | null
  monetaryHash?: string | null
  relatedJournalId?: string | null
  approvalReason?: string | null
}

function auditData(params: FinancialAuditInput) {
  return {
    userId: params.userId && isUUID(params.userId) ? params.userId : null,
    action: params.action.slice(0, 100),
    entityType: params.entityType.slice(0, 60),
    entityId: params.entityId && isUUID(params.entityId) ? params.entityId : null,
    entityKey: params.entityId ? String(params.entityId).slice(0, 120) : null,
    requestId: params.requestId?.slice(0, 120) ?? null,
    monetaryHash: params.monetaryHash?.slice(0, 128) ?? null,
    relatedJournalId: params.relatedJournalId && isUUID(params.relatedJournalId) ? params.relatedJournalId : null,
    approvalReason: params.approvalReason?.slice(0, 500) ?? null,
    oldValues: (params.oldValues ?? undefined) as any,
    newValues: (params.newValues ?? undefined) as any,
    ipAddress: params.ipAddress ?? null,
  }
}

/**
 * Financial audit events are controls, not optional telemetry. This helper is
 * deliberately fail-closed. Call it inside the same Prisma transaction as the
 * financial mutation whenever possible.
 */
export async function writeFinancialAuditInTx(
  tx: Prisma.TransactionClient,
  params: FinancialAuditInput,
): Promise<void> {
  await tx.auditLog.create({ data: auditData(params) })
  await tx.financialAuditEvent.create({
    data: {
      entityType: params.entityType.slice(0, 60),
      entityKey: String(params.entityId ?? 'unknown').slice(0, 120),
      action: params.action.slice(0, 100),
      actorId: params.userId && isUUID(params.userId) ? params.userId : null,
      requestId: params.requestId?.slice(0, 120) ?? null,
      monetaryHash: params.monetaryHash?.slice(0, 128) ?? null,
      relatedJournalId: params.relatedJournalId && isUUID(params.relatedJournalId) ? params.relatedJournalId : null,
      reason: params.approvalReason?.slice(0, 500) ?? null,
      payload: {
        oldValues: params.oldValues ?? null,
        newValues: params.newValues ?? null,
        ipAddress: params.ipAddress ?? null,
      } as any,
    },
  })
}

/** Fail-closed top-level audit write for financial mutations not yet wrapped in a transaction. */
export async function writeFinancialAudit(params: FinancialAuditInput): Promise<void> {
  await prisma.$transaction(async tx => {
    await writeFinancialAuditInTx(tx, params)
  })
}
