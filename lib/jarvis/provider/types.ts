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

/** A photo or PDF the user attached to this turn (base64, no data: prefix). */
export interface JarvisAttachment {
  name: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf'
  data: string
}

export interface JarvisToolLoopArgs {
  system: string
  history: ChatTurnMessage[]
  userMessage: string
  attachments?: JarvisAttachment[]
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

/**
 * Room for the answer. 2,048 cut longer replies off mid-sentence once a few
 * tool results were in the conversation, and only the Anthropic provider
 * raised it for itself — the Gemini path answered inside the smaller budget.
 */
export const JARVIS_MAX_TOKENS = 8192
export const JARVIS_MAX_TOOL_ROUNDS = 6

export function resolveJarvisProviderId(env: NodeJS.ProcessEnv = process.env): JarvisProviderId {
  const raw = String(env.JARVIS_PROVIDER || '').trim().toLowerCase()
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic'
  if (raw === 'gemini' || raw === 'google') return 'gemini'
  // Unset: take the stronger model where its key is present. DIA routes a
  // question across twenty-odd ERP tools and has to read back what they
  // return; a small fast model picks the wrong tool and answers from nothing,
  // which reads to the person asking as "it does not know its own system".
  return (env.ANTHROPIC_API_KEY || '').trim() ? 'anthropic' : 'gemini'
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
