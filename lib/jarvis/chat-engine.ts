import 'server-only'

import type { PublicUser } from '@/lib/auth/types'
import { getAnthropicClient, JARVIS_MAX_TOKENS, JARVIS_MAX_TOOL_ROUNDS, JARVIS_MODEL } from './anthropic-client'
import { buildSystemPrompt } from './system-prompt'
import { anthropicToolsFor } from './tools'
import { allowedToolNamesForRole } from './permissions'
import { runTool } from './run-tool'

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
}

// Runs one user turn through Claude with tool-calling, executing every
// requested tool through runTool() (permission check + audit log), and
// looping until the model stops asking for tools or we hit the round cap.
export async function runChatTurn(params: {
  user: PublicUser
  conversationId: string
  ipAddress: string | null
  history: ChatTurnMessage[]
  userMessage: string
}): Promise<ChatTurnResult> {
  const { user, conversationId, ipAddress, history, userMessage } = params

  const client = getAnthropicClient()
  const allowedNames = allowedToolNamesForRole(user.role)
  const tools = anthropicToolsFor(allowedNames)
  const system = buildSystemPrompt(user)

  const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const toolCalls: ToolCallRecord[] = []

  for (let round = 0; round < JARVIS_MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: JARVIS_MODEL,
      max_tokens: JARVIS_MAX_TOKENS,
      system,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    })

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('\n')
        .trim()
      return { reply: text || "I don't have a response for that.", toolCalls }
    }

    // Model wants to call one or more tools — execute each through the
    // permission + audit choke point, then feed results back.
    messages.push({ role: 'assistant', content: response.content })

    const toolResultBlocks: Array<Record<string, unknown>> = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      const outcome = await runTool(block.name, block.input, {
        user,
        conversationId,
        ipAddress,
      })

      toolCalls.push({
        toolName: block.name,
        input: block.input,
        allowed: outcome.allowed,
        output: outcome.output,
        error: outcome.error,
      })

      const resultPayload = outcome.allowed
        ? (outcome.error ? { error: outcome.error } : outcome.output)
        : { error: outcome.error ?? 'Permission denied' }

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(resultPayload).slice(0, 8000),
      })
    }

    messages.push({ role: 'user', content: toolResultBlocks })
  }

  return {
    reply: 'I needed too many tool calls to answer that — please narrow your question and try again.',
    toolCalls,
  }
}
