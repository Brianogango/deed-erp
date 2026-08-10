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

export function createAnthropicJarvisProvider(): JarvisLlmProvider {
  const model = process.env.ANTHROPIC_MODEL || process.env.JARVIS_MODEL || 'claude-sonnet-4-6'

  return {
    id: 'anthropic',
    model,
    async runToolLoop(args: JarvisToolLoopArgs): Promise<JarvisToolLoopResult> {
      const client = getClient()
      const maxRounds = args.maxRounds || JARVIS_MAX_TOOL_ROUNDS
      const maxTokens = args.maxTokens || JARVIS_MAX_TOKENS
      const tools = args.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }))

      const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
        ...args.history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: args.userMessage },
      ]

      const toolCalls: JarvisToolLoopResult['toolCalls'] = []

      for (let round = 0; round < maxRounds; round += 1) {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: args.system,
          messages,
          tools: tools.length > 0 ? tools : undefined,
        })

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
            content: JSON.stringify(resultPayload).slice(0, 8000),
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
