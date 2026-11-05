import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import type { JarvisLlmProvider, JarvisToolLoopArgs, JarvisToolLoopResult } from './types'
import { JARVIS_MAX_TOKENS, JARVIS_MAX_TOOL_ROUNDS } from './types'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured — set JARVIS_PROVIDER=gemini or provide Anthropic credentials')
  }
  _client = new Anthropic({ apiKey })
  return _client
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * Effort for the DIA: ANTHROPIC_EFFORT when set, else low (quick answers for
 * routine ERP work). Only sent to models that accept it.
 */
export function anthropicEffort(model: string, env: NodeJS.ProcessEnv = process.env): Effort | undefined {
  const raw = String(env.ANTHROPIC_EFFORT || '').trim().toLowerCase() as Effort
  const supports = /claude-(opus|sonnet|fable|haiku)-5|claude-(opus|sonnet)-4-[6-9]/.test(model)
  if (!supports) return undefined
  return EFFORTS.has(raw) ? raw : 'low'
}

/** Thinking is always on for the current models and counts toward max_tokens. */
const ANTHROPIC_MAX_TOKENS = 16000

function userContent(text: string, attachments: JarvisToolLoopArgs['attachments']): Anthropic.MessageParam['content'] {
  if (!attachments?.length) return text
  const blocks: Anthropic.ContentBlockParam[] = attachments.map(a => a.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
    : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } })
  blocks.push({ type: 'text', text })
  return blocks
}

export function createAnthropicJarvisProvider(): JarvisLlmProvider {
  const model = process.env.ANTHROPIC_MODEL || process.env.JARVIS_MODEL || 'claude-opus-5-5'
  const effort = anthropicEffort(model)

  return {
    id: 'anthropic',
    model,
    async runToolLoop(args: JarvisToolLoopArgs): Promise<JarvisToolLoopResult> {
      const client = getClient()
      const maxRounds = args.maxRounds || JARVIS_MAX_TOOL_ROUNDS
      const maxTokens = Math.max(args.maxTokens || JARVIS_MAX_TOKENS, ANTHROPIC_MAX_TOKENS)
      const tools = args.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }))

      const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
        ...args.history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent(args.userMessage, args.attachments) },
      ]

      const toolCalls: JarvisToolLoopResult['toolCalls'] = []

      for (let round = 0; round < maxRounds; round += 1) {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: args.system,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          ...(effort ? { output_config: { effort } } : {}),
        })

        if (response.stop_reason === 'refusal') {
          return {
            reply: "I can't help with that request. Try rephrasing it, or ask about a specific ERP record.",
            toolCalls,
            provider: 'anthropic',
            model,
          }
        }

        if (response.stop_reason !== 'tool_use') {
          const text = response.content
            .map(b => (b.type === 'text' ? b.text : ''))
            .join('\n')
            .trim()
          return {
            reply: text || "I don't have a response for that.",
            toolCalls,
            provider: 'anthropic',
            model,
          }
        }

        messages.push({ role: 'assistant', content: response.content })

        const toolResultBlocks: Array<Record<string, unknown>> = []
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          const outcome = await args.onToolCall(block.name, block.input)
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
            content: JSON.stringify(resultPayload).slice(0, 24000),
          })
        }
        messages.push({ role: 'user', content: toolResultBlocks })
      }

      return {
        reply: 'I needed too many tool calls to answer that — please narrow your question and try again.',
        toolCalls,
        provider: 'anthropic',
        model,
      }
    },
  }
}
