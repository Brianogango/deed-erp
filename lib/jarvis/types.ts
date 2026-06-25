import type { ModuleId, PublicUser } from '@/lib/auth/types'
import type { PermissionAction } from '@/lib/auth/authorization'

// A tool never receives raw request data — only the validated input shape
// and the authenticated user it's running on behalf of.
export interface ToolContext {
  user: PublicUser
  conversationId: string | null
  ipAddress: string | null
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string
  description: string
  // JSON Schema handed to the Anthropic tool-use API.
  inputSchema: Record<string, unknown>
  // Module that owns the underlying data — checked via hasModuleAccess.
  requiredModule: ModuleId | null
  // Optional finer-grained permission action (lib/auth/authorization.ts).
  requiredPermission: PermissionAction | null
  // Pure read or drafting only — never a direct ERP write.
  mutates: false
  run: (ctx: ToolContext, input: TInput) => Promise<TOutput>
}

export interface ToolRunResult {
  allowed: boolean
  output?: unknown
  error?: string
  durationMs: number
}
