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
  // Pure read / draft by default. Controlled writes (e.g. sales-inbox → CRM
  // lead import) may set mutates: true — still always go through runTool().
  mutates: boolean
  run: (ctx: ToolContext, input: TInput) => Promise<TOutput>
  /**
   * Writes that need the person's OK. `run` then only checks and previews,
   * returning a ConfirmPreview; nothing is saved until they click Confirm,
   * which calls `execute` with the previewed input (permissions re-checked).
   */
  confirm?: {
    execute: (ctx: ToolContext, input: any) => Promise<ConfirmResult>
  }
}

export interface ConfirmPreview {
  ok: true
  needsConfirmation: true
  /** Card heading, e.g. "New vendor · Acme Ltd". */
  title: string
  lines: Array<{ label: string; value: string }>
  warnings?: string[]
  /** What `execute` receives — resolved ids, not the raw request. */
  input: unknown
  /** Told to the model: what the card shows and that the user must confirm. */
  message: string
}

export interface ConfirmResult {
  ok: boolean
  message: string
  ref?: string
  id?: string
  /** Where to open the record. */
  href?: string
}

export const isConfirmPreview = (value: unknown): value is ConfirmPreview =>
  !!value && typeof value === 'object' && (value as ConfirmPreview).needsConfirmation === true && (value as ConfirmPreview).ok === true
