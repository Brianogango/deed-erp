import { describe, expect, it } from 'vitest'
import { extractDiaActions } from '@/lib/jarvis/actions'
import {
  formatPageContextForPrompt,
  isDiaMode,
  modePromptBias,
  moduleFromPathname,
  startersForMode,
} from '@/lib/jarvis/modes'
import type { ToolCallRecord } from '@/lib/jarvis/chat-engine'

describe('DIA modes', () => {
  it('accepts the five product surfaces', () => {
    expect(isDiaMode('search')).toBe(true)
    expect(isDiaMode('voice')).toBe(true)
    expect(isDiaMode('insights')).toBe(true)
    expect(isDiaMode('actions')).toBe(true)
    expect(isDiaMode('assist')).toBe(true)
    expect(isDiaMode('jarvis')).toBe(false)
  })

  it('maps ERP paths to assist modules', () => {
    expect(moduleFromPathname('/repairs/REP-1')).toBe('repairs')
    expect(moduleFromPathname('/sales')).toBe('sales')
    expect(moduleFromPathname('/finance/invoices')).toBe('finance')
    expect(moduleFromPathname('/unknown-thing')).toBe(null)
  })

  it('biases prompts per mode', () => {
    expect(modePromptBias('search')).toMatch(/Search/)
    expect(modePromptBias('insights')).toMatch(/summarize_repairs/)
    expect(modePromptBias('actions')).toMatch(/draft_quotation/)
    expect(modePromptBias('assist')).toMatch(/page context/i)
  })

  it('formats page context for the system prompt', () => {
    expect(formatPageContextForPrompt({ pathname: '/sales', module: 'sales' })).toContain(
      'pathname: /sales',
    )
    expect(formatPageContextForPrompt(null)).toBe('')
  })

  it('returns mode starters including assist context', () => {
    expect(startersForMode('search').length).toBeGreaterThan(0)
    expect(startersForMode('insights').some(s => /Summarize|Show|Give/i.test(s.prompt))).toBe(true)
    const repairAssist = startersForMode('assist', { pathname: '/repairs', module: 'repairs' })
    expect(repairAssist.some(s => /repair/i.test(s.label + s.prompt))).toBe(true)
  })
})

describe('extractDiaActions', () => {
  it('builds draft_message and draft_quotation cards', () => {
    const toolCalls: ToolCallRecord[] = [
      {
        toolName: 'draft_message',
        input: {},
        allowed: true,
        output: {
          draftMessage: {
            channel: 'whatsapp',
            body: 'Your repair is ready.',
            recipientName: 'Ada',
          },
        },
      },
      {
        toolName: 'draft_quotation',
        input: {},
        allowed: true,
        output: {
          ok: true,
          draftQuote: {
            companyName: 'Acme',
            clientId: 'c1',
            totalAmount: 120000,
            lines: [{ sku: 'T14' }],
            notes: null,
          },
        },
      },
      {
        toolName: 'import_sales_inbox_leads',
        input: {},
        allowed: true,
        output: { imported: 2, skipped: 1, message: 'done' },
      },
      {
        toolName: 'draft_message',
        input: {},
        allowed: false,
        error: 'denied',
        output: { draftMessage: { channel: 'email', body: 'nope' } },
      },
    ]

    const actions = extractDiaActions(toolCalls)
    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({ type: 'draft_message', channel: 'whatsapp', body: 'Your repair is ready.' })
    expect(actions[1]).toMatchObject({ type: 'draft_quotation', companyName: 'Acme', lineCount: 1 })
    expect(actions[2]).toMatchObject({ type: 'import_leads', imported: 2, skipped: 1 })
  })
})
