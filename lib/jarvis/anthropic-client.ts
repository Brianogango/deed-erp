import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured — JARVIS is disabled until it is set')
  }
  _client = new Anthropic({ apiKey })
  return _client
}

export const JARVIS_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
export const JARVIS_MAX_TOKENS = 2048
export const JARVIS_MAX_TOOL_ROUNDS = 6
