import 'server-only'

import type { PublicUser } from '@/lib/auth/types'
import { getJarvisProvider, JARVIS_MAX_TOKENS, JARVIS_MAX_TOOL_ROUNDS } from './provider'
import { buildSystemPrompt } from './system-prompt'
import { allTools } from './tools'
import { allowedToolNamesForRole } from './permissions'
import { runTool } from './run-tool'
import {
  buildAnswerSources,
  formatKnowledgeForPrompt,
  retrieveKnowledge,
  type AnswerSource,
} from './knowledge'
import type { JarvisToolDef } from './provider'
import { extractDiaActions, type DiaActionCard } from './actions'
import type { DiaMode, DiaPageContext } from './modes'

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
  sources: AnswerSource[]
  actions: DiaActionCard[]
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
 * with knowledge retrieval + ERP tool-calling. Tools still execute only via
 * runTool() — permission check + audit — never arbitrary SQL or direct writes.
 */
export async function runChatTurn(params: {
  user: PublicUser
  conversationId: string
  ipAddress: string | null
  history: ChatTurnMessage[]
  userMessage: string
  mode?: DiaMode | null
  pageContext?: DiaPageContext | null
}): Promise<ChatTurnResult> {
  const { user, conversationId, ipAddress, history, userMessage, mode, pageContext } = params

  const provider = getJarvisProvider()
  const allowedNames = allowedToolNamesForRole(user.role)
  const tools = toolsForRole(allowedNames)
  const system = buildSystemPrompt(user, { mode, pageContext })

  // Auto-RAG: retrieve static knowledge before the model runs, then still
  // allow search_documents / live ERP tools for follow-up facts.
  // Search mode always prefers knowledge retrieval when the tool is allowed.
  const shouldRetrieve = allowedNames.includes('search_documents')
    && (mode === 'search' || mode === 'assist' || mode == null || mode === 'voice')
  const passages = shouldRetrieve
    ? await retrieveKnowledge(userMessage, mode === 'search' ? 8 : 5)
    : []
  const knowledgeBlock = formatKnowledgeForPrompt(passages)
  const augmentedMessage = knowledgeBlock
    ? `${userMessage}\n\n---\n${knowledgeBlock}`
    : userMessage

  const result = await provider.runToolLoop({
    system,
    history,
    userMessage: augmentedMessage,
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

  const toolCalls: ToolCallRecord[] = result.toolCalls
  const sources = buildAnswerSources(passages, toolCalls)
  const actions = extractDiaActions(toolCalls)

  return {
    reply: result.reply,
    toolCalls,
    sources,
    actions,
    provider: result.provider,
    model: result.model,
  }
}
