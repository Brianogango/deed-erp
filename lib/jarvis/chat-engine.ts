import 'server-only'

import type { PublicUser } from '@/lib/auth/types'
import { getJarvisProvider, JARVIS_MAX_TOKENS, JARVIS_MAX_TOOL_ROUNDS } from './provider'
import { buildSystemPrompt } from './system-prompt'
import { allTools } from './tools'
import { allowedToolNamesForRole } from './permissions'
import { runTool } from './run-tool'
import type { JarvisToolDef } from './provider'

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

export interface ChatTurnResult {
  reply: string
  toolCalls: ToolCallRecord[]
  provider?: string
  model?: string
}

function toolsForRole(allowedNames: string[]): JarvisToolDef[] {
  return allTools()
    .filter(t => allowedNames.includes(t.name))
    .map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
}

/**
 * Runs one user turn through the configured LLM provider (Gemini by default)
 * with ERP tool-calling. Tools still execute only via runTool() — permission
 * check + audit — never arbitrary SQL or direct writes.
 */
export async function runChatTurn(params: {
  user: PublicUser
  conversationId: string
  ipAddress: string | null
  history: ChatTurnMessage[]
  userMessage: string
}): Promise<ChatTurnResult> {
  const { user, conversationId, ipAddress, history, userMessage } = params

  const provider = getJarvisProvider()
  const allowedNames = allowedToolNamesForRole(user.role)
  const tools = toolsForRole(allowedNames)
  const system = buildSystemPrompt(user)

  const result = await provider.runToolLoop({
    system,
    history,
    userMessage,
    tools,
    maxRounds: JARVIS_MAX_TOOL_ROUNDS,
    maxTokens: JARVIS_MAX_TOKENS,
    onToolCall: async (name, input) => {
      const outcome = await runTool(name, input, {
        user,
        conversationId,
        ipAddress,
      })
      return {
        allowed: outcome.allowed,
        output: outcome.output,
        error: outcome.error,
      }
    },
  })

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    provider: result.provider,
    model: result.model,
  }
}
