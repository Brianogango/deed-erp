import 'server-only'

import prisma from '@/lib/prisma'

export interface AiAuditEntry {
  userId: string | null
  conversationId: string | null
  toolName: string
  permissionChecked: string
  allowed: boolean
  inputParams?: unknown
  resultMeta?: unknown
  errorMessage?: string
  durationMs?: number
  ipAddress?: string | null
}

// Every JARVIS tool call — allowed or denied — gets one row here.
// Never write the full ERP record into resultMeta; row counts / ids only,
// so this table can't become a second, unguarded copy of business data.
export async function writeAiAuditLog(entry: AiAuditEntry): Promise<void> {
  try {
    await prisma.aiAuditLog.create({
      data: {
        userId: entry.userId,
        conversationId: entry.conversationId,
        toolName: entry.toolName,
        permissionChecked: entry.permissionChecked,
        allowed: entry.allowed,
        inputParams: entry.inputParams as any,
        resultMeta: entry.resultMeta as any,
        errorMessage: entry.errorMessage,
        durationMs: entry.durationMs,
        ipAddress: entry.ipAddress ?? null,
      },
    })
  } catch (err) {
    // Audit logging must never break the chat flow, but it must be loud
    // in server logs if it's failing.
    console.error('[jarvis] failed to write ai_audit_logs entry:', err)
  }
}
