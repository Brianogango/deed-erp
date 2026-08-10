import { describe, expect, it } from 'vitest'
import { SchemaType } from '@google/generative-ai'
import { jarvisProviderConfigured, resolveJarvisProviderId } from '@/lib/jarvis/provider'
import { toGeminiParameters } from '@/lib/jarvis/provider/gemini'
import { allTools } from '@/lib/jarvis/tools'
import { draftQuotationTool } from '@/lib/jarvis/tools/draft-quotation'

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

describe('toGeminiParameters', () => {
  it('includes items for nested array/object (draft_quotation)', () => {
    const params = toGeminiParameters(draftQuotationTool.inputSchema) as any
    expect(params.type).toBe(SchemaType.OBJECT)
    expect(params.properties.lines.type).toBe(SchemaType.ARRAY)
    expect(params.properties.lines.items).toBeTruthy()
    expect(params.properties.lines.items.type).toBe(SchemaType.OBJECT)
    expect(params.properties.lines.items.properties.productQuery.type).toBe(SchemaType.STRING)
    expect(params.properties.lines.items.properties.qty.type).toBe(SchemaType.NUMBER)
  })

  it('converts every registered tool without throwing', () => {
    for (const tool of allTools()) {
      expect(() => toGeminiParameters(tool.inputSchema)).not.toThrow()
      const params = toGeminiParameters(tool.inputSchema) as any
      expect(params.type).toBe(SchemaType.OBJECT)
      expect(params.properties).toBeTruthy()
    }
  })
})
