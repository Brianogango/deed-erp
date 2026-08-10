/**
 * @deprecated Import from `@/lib/jarvis/provider` instead.
 * Kept so older imports keep working while JARVIS uses the AI service layer.
 */
export {
  JARVIS_MAX_TOKENS,
  JARVIS_MAX_TOOL_ROUNDS,
} from './provider'

export function getAnthropicClient(): never {
  throw new Error(
    'getAnthropicClient() is deprecated — use getJarvisProvider() from @/lib/jarvis/provider',
  )
}

export const JARVIS_MODEL = process.env.ANTHROPIC_MODEL || process.env.JARVIS_MODEL || 'claude-sonnet-4-6'
