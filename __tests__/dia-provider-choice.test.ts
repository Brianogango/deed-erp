import { describe, expect, it } from 'vitest'
import { resolveJarvisProviderId, JARVIS_MAX_TOKENS } from '@/lib/jarvis/provider/types'

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv

/**
 * DIA picks between twenty-odd ERP tools per question and then has to read
 * back what they return. On a small fast model it picks the wrong tool and
 * answers from nothing, which reads to the person asking as DIA not knowing
 * its own system — so an unset provider takes the stronger model where the
 * key for it exists.
 */
describe('which model answers', () => {
  it('prefers Anthropic when its key is set and nothing is pinned', () => {
    expect(resolveJarvisProviderId(env({ ANTHROPIC_API_KEY: 'sk-x', GEMINI_API_KEY: 'g' }))).toBe('anthropic')
  })

  it('falls to Gemini when there is no Anthropic key', () => {
    expect(resolveJarvisProviderId(env({ GEMINI_API_KEY: 'g' }))).toBe('gemini')
    expect(resolveJarvisProviderId(env({}))).toBe('gemini')
  })

  it('obeys an explicit pin either way', () => {
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk-x' }))).toBe('gemini')
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: 'anthropic' }))).toBe('anthropic')
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: 'claude' }))).toBe('anthropic')
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: 'google', ANTHROPIC_API_KEY: 'sk-x' }))).toBe('gemini')
  })

  it('ignores a blank or unknown pin rather than guessing', () => {
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: '  ', ANTHROPIC_API_KEY: 'sk-x' }))).toBe('anthropic')
    expect(resolveJarvisProviderId(env({ JARVIS_PROVIDER: 'llama', ANTHROPIC_API_KEY: 'sk-x' }))).toBe('anthropic')
  })

  // 2,048 cut answers off once a few tool results were in the conversation,
  // and only the Anthropic provider raised it for itself.
  it('leaves room for an answer that quotes its tool results', () => {
    expect(JARVIS_MAX_TOKENS).toBeGreaterThanOrEqual(8192)
  })
})
