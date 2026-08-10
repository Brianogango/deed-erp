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
