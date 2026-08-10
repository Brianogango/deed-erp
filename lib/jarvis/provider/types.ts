import 'server-only'

export type JarvisProviderId = 'gemini' | 'anthropic'

export interface ChatTurnMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ToolCallRecord {
  toolName: string
  input: unknown
  allowed: boolean
  output?: unknown
  error?: string
}

export interface JarvisToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface JarvisToolLoopArgs {
  system: string
  history: ChatTurnMessage[]
  userMessage: string
  tools: JarvisToolDef[]
  maxRounds: number
  maxTokens: number
  /** Execute one ERP tool through the permission + audit choke point. */
  onToolCall: (name: string, input: unknown) => Promise<{
    allowed: boolean
    output?: unknown
    error?: string
  }>
}

export interface JarvisToolLoopResult {
  reply: string
  toolCalls: ToolCallRecord[]
  provider: JarvisProviderId
  model: string
}

export interface JarvisLlmProvider {
  id: JarvisProviderId
  model: string
  runToolLoop: (args: JarvisToolLoopArgs) => Promise<JarvisToolLoopResult>
}

export const JARVIS_MAX_TOKENS = 2048
export const JARVIS_MAX_TOOL_ROUNDS = 6

export function resolveJarvisProviderId(env: NodeJS.ProcessEnv = process.env): JarvisProviderId {
  const raw = String(env.JARVIS_PROVIDER || 'gemini').trim().toLowerCase()
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic'
  return 'gemini'
}

export function jarvisProviderConfigured(env: NodeJS.ProcessEnv = process.env): {
  provider: JarvisProviderId
  configured: boolean
  missing?: string
} {
  const provider = resolveJarvisProviderId(env)
  if (provider === 'gemini') {
    const key = (env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || '').trim()
    return key
      ? { provider, configured: true }
      : { provider, configured: false, missing: 'GEMINI_API_KEY' }
  }
  const key = (env.ANTHROPIC_API_KEY || '').trim()
  return key
    ? { provider, configured: true }
    : { provider, configured: false, missing: 'ANTHROPIC_API_KEY' }
}
