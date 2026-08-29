import 'server-only'

import { createAnthropicJarvisProvider } from './anthropic'
import { createGeminiJarvisProvider } from './gemini'
import {
  jarvisProviderConfigured,
  resolveJarvisProviderId,
  type JarvisLlmProvider,
  type JarvisProviderId,
} from './types'

export {
  JARVIS_MAX_TOKENS,
  JARVIS_MAX_TOOL_ROUNDS,
  jarvisProviderConfigured,
  resolveJarvisProviderId,
} from './types'
export type { JarvisLlmProvider, JarvisProviderId, JarvisToolDef } from './types'

/**
 * AI Service Layer entry — ERP modules talk to this, not Gemini/Anthropic SDKs.
 * Switch providers with JARVIS_PROVIDER=gemini|anthropic without rewriting tools.
 */
export function getJarvisProvider(env: NodeJS.ProcessEnv = process.env): JarvisLlmProvider {
  const id = resolveJarvisProviderId(env)
  if (id === 'anthropic') return createAnthropicJarvisProvider()
  return createGeminiJarvisProvider()
}

/** True for provider overload / rate-limit / 5xx errors worth retrying on the other provider. */
export function isProviderOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /503|502|500|overload|high demand|rate.?limit|too many requests|capacity|unavailable/i.test(msg)
}

/**
 * Primary + fallback providers. When Gemini is overloaded (or Anthropic is
 * down), the chat engine retries the same tool loop on the other provider —
 * tools and permissions are identical, only the model changes.
 */
export function getJarvisProvidersWithFallback(env: NodeJS.ProcessEnv = process.env): {
  primary: JarvisLlmProvider
  fallback: JarvisLlmProvider | null
} {
  const primary = getJarvisProvider(env)
  const primaryId = resolveJarvisProviderId(env)
  const fallbackId: JarvisProviderId = primaryId === 'anthropic' ? 'gemini' : 'anthropic'
  const fallbackConfigured = fallbackId === 'gemini'
    ? Boolean((env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || '').trim())
    : Boolean((env.ANTHROPIC_API_KEY || '').trim())
  const fallback = fallbackConfigured
    ? (fallbackId === 'gemini' ? createGeminiJarvisProvider() : createAnthropicJarvisProvider())
    : null
  return { primary, fallback }
}

export function describeJarvisProvider(env: NodeJS.ProcessEnv = process.env) {
  const status = jarvisProviderConfigured(env)
  if (!status.configured) {
    return { ...status, model: null as string | null }
  }
  try {
    const provider = getJarvisProvider(env)
    return { ...status, model: provider.model }
  } catch {
    return { ...status, configured: false, model: null as string | null }
  }
}
