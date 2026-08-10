import { describe, expect, it } from 'vitest'
import { jarvisProviderConfigured, resolveJarvisProviderId } from '@/lib/jarvis/provider'

describe('Jarvis provider resolution', () => {
  it('defaults to gemini', () => {
    expect(resolveJarvisProviderId({} as unknown as NodeJS.ProcessEnv)).toBe('gemini')
  })

  it('accepts anthropic / claude aliases', () => {
    expect(resolveJarvisProviderId({ JARVIS_PROVIDER: 'anthropic' } as unknown as NodeJS.ProcessEnv)).toBe('anthropic')
    expect(resolveJarvisProviderId({ JARVIS_PROVIDER: 'claude' } as unknown as NodeJS.ProcessEnv)).toBe('anthropic')
  })

  it('reports missing Gemini key when selected', () => {
    const status = jarvisProviderConfigured({
      JARVIS_PROVIDER: 'gemini',
    } as unknown as NodeJS.ProcessEnv)
    expect(status).toMatchObject({ provider: 'gemini', configured: false, missing: 'GEMINI_API_KEY' })
  })

  it('accepts GEMINI_API_KEY or GOOGLE_AI_API_KEY', () => {
    expect(jarvisProviderConfigured({
      JARVIS_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
    } as unknown as NodeJS.ProcessEnv).configured).toBe(true)
    expect(jarvisProviderConfigured({
      JARVIS_PROVIDER: 'gemini',
      GOOGLE_AI_API_KEY: 'test-key',
    } as unknown as NodeJS.ProcessEnv).configured).toBe(true)
  })
})
