import 'server-only'

import type { PublicUser } from '@/lib/auth/types'
import { checkToolPermission } from './permissions'
import { writeAiAuditLog } from './audit'
import { getTool } from './tools'
import type { ToolContext } from './types'

export interface RunToolOutcome {
  allowed: boolean
  output?: unknown
  error?: string
}

// Single choke point every tool call passes through: permission check,
// timing, execution, and an audit log row — allowed or denied. The chat
// route never calls a tool's `run()` directly.
export async function runTool(
  toolName: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<RunToolOutcome> {
  const started = Date.now()
  const tool = getTool(toolName)

  if (!tool) {
    await writeAiAuditLog({
      userId: ctx.user.id,
      conversationId: ctx.conversationId,
      toolName,
      permissionChecked: 'tool_exists',
      allowed: false,
      inputParams: rawInput,
      errorMessage: 'Unknown tool',
      durationMs: Date.now() - started,
      ipAddress: ctx.ipAddress,
    })
    return { allowed: false, error: `Unknown tool: ${toolName}` }
  }

  const permission = checkToolPermission(ctx.user, tool)
  if (!permission.allowed) {
    await writeAiAuditLog({
      userId: ctx.user.id,
      conversationId: ctx.conversationId,
      toolName,
      permissionChecked: tool.requiredPermission ?? tool.requiredModule ?? 'role_allowlist',
      allowed: false,
      inputParams: rawInput,
      errorMessage: permission.reason,
      durationMs: Date.now() - started,
      ipAddress: ctx.ipAddress,
    })
    return { allowed: false, error: permission.reason }
  }

  try {
    const output = await tool.run(ctx, rawInput as never)
    await writeAiAuditLog({
      userId: ctx.user.id,
      conversationId: ctx.conversationId,
      toolName,
      permissionChecked: tool.requiredPermission ?? tool.requiredModule ?? 'role_allowlist',
      allowed: true,
      inputParams: rawInput,
      resultMeta: summarizeForAudit(output),
      durationMs: Date.now() - started,
      ipAddress: ctx.ipAddress,
    })
    return { allowed: true, output }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed'
    await writeAiAuditLog({
      userId: ctx.user.id,
      conversationId: ctx.conversationId,
      toolName,
      permissionChecked: tool.requiredPermission ?? tool.requiredModule ?? 'role_allowlist',
      allowed: true,
      inputParams: rawInput,
      errorMessage: message,
      durationMs: Date.now() - started,
      ipAddress: ctx.ipAddress,
    })
    return { allowed: true, error: message }
  }
}

// Keep the audit trail lightweight — never duplicate full ERP records into
// ai_audit_logs. Just enough to tell what happened.
function summarizeForAudit(output: unknown): unknown {
  if (Array.isArray(output)) return { type: 'array', count: output.length }
  if (output && typeof output === 'object') {
    const keys = Object.keys(output as Record<string, unknown>)
    return { type: 'object', keys }
  }
  return { type: typeof output }
}
