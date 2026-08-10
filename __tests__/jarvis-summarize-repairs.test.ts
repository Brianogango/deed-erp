import { describe, expect, it } from 'vitest'
import { SchemaType } from '@google/generative-ai'
import { toGeminiParameters } from '@/lib/jarvis/provider/gemini'
import { summarizeRepairsTool } from '@/lib/jarvis/tools/summarize-repairs'
import { isToolAllowedForRole } from '@/lib/jarvis/permissions'

describe('summarize_repairs tool', () => {
  it('exposes a Gemini-safe schema', () => {
    const params = toGeminiParameters(summarizeRepairsTool.inputSchema) as any
    expect(params.type).toBe(SchemaType.OBJECT)
    expect(params.properties.fromDate.type).toBe(SchemaType.STRING)
    expect(params.properties.toDate.type).toBe(SchemaType.STRING)
    expect(params.required).toEqual(expect.arrayContaining(['fromDate', 'toDate']))
  })

  it('is allowed for director, technical_lead, technician; not sales_rep', () => {
    expect(isToolAllowedForRole('summarize_repairs', 'director')).toBe(true)
    expect(isToolAllowedForRole('summarize_repairs', 'technical_lead')).toBe(true)
    expect(isToolAllowedForRole('summarize_repairs', 'technician')).toBe(true)
    expect(isToolAllowedForRole('summarize_repairs', 'sales_rep')).toBe(false)
  })
})
