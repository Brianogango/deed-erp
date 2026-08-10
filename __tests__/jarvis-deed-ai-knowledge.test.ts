import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from '@/lib/jarvis/ingest'
import { buildAnswerSources, formatKnowledgeForPrompt, type KnowledgePassage } from '@/lib/jarvis/knowledge'
import { buildSystemPrompt } from '@/lib/jarvis/system-prompt'

describe('htmlToPlainText', () => {
  it('strips tags and keeps readable text', () => {
    const text = htmlToPlainText('<p>Hello <strong>Deed</strong></p><script>bad()</script><p>Policy</p>')
    expect(text).toContain('Hello')
    expect(text).toContain('Deed')
    expect(text).toContain('Policy')
    expect(text).not.toContain('script')
    expect(text).not.toContain('<')
  })
})

describe('knowledge sources', () => {
  const passages: KnowledgePassage[] = [
    {
      chunkId: 'c1',
      documentId: 'd1',
      title: 'Refund and Returns Policy',
      excerpt: 'Returns within 7 days…',
      sourceType: 'website',
      sourceUrl: 'https://deed.africa/refund-and-returns-policy/',
      category: 'page',
      updatedAt: '2024-08-30T17:59:23.000Z',
      rank: 0.8,
    },
  ]

  it('formats passages for the model prompt', () => {
    const block = formatKnowledgeForPrompt(passages)
    expect(block).toContain('Refund and Returns Policy')
    expect(block).toContain('https://deed.africa/refund-and-returns-policy/')
  })

  it('builds live + knowledge source chips', () => {
    const sources = buildAnswerSources(passages, [
      {
        toolName: 'check_inventory',
        allowed: true,
        output: { count: 6, products: [] },
      },
      {
        toolName: 'track_repair',
        allowed: false,
        output: { jobNumber: 'REP-1' },
      },
    ])

    expect(sources.some(s => s.kind === 'live' && s.label === 'Inventory')).toBe(true)
    expect(sources.some(s => s.kind === 'knowledge' && s.label === 'Refund and Returns Policy')).toBe(true)
    expect(sources.every(s => s.kind !== 'live' || s.label !== 'Repair')).toBe(true)
  })
})

describe('DIA system prompt', () => {
  it('distinguishes knowledge vs live ERP', () => {
    const prompt = buildSystemPrompt({
      id: 'u1',
      username: 'ada',
      name: 'Ada',
      email: 'ada@deed.co.ke',
      role: 'director',
      modules: ['jarvis'],
      active: true,
      createdAt: new Date().toISOString(),
    })
    expect(prompt).toContain('DIA')
    expect(prompt).toContain('Deed Intelligence Assistant')
    expect(prompt).toContain('search_documents')
    expect(prompt).toContain('Sources:')
  })
})
