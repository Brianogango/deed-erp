import type { ToolCallRecord } from './chat-engine'

/**
 * Structured action cards returned to the DIA Actions UI from successful
 * tool outputs (drafts / controlled imports). The model never sends mail
 * or saves quotes — the human confirms in the ERP.
 */

export type DiaActionCard =
  | {
      type: 'draft_message'
      channel: 'email' | 'whatsapp'
      subject?: string
      body: string
      recipientName?: string
    }
  | {
      type: 'draft_quotation'
      companyName: string
      clientId: string
      totalAmount: number
      lineCount: number
      notes?: string | null
      draftQuote: Record<string, unknown>
    }
  | {
      type: 'confirm_action'
      tool: string
      title: string
      lines: Array<{ label: string; value: string }>
      warnings?: string[]
      token: string
    }
  | {
      type: 'report'
      title: string
      period?: { from: string; to: string }
      filters: Record<string, string>
      columns: string[]
      rows: Array<Record<string, string | number | null>>
      totals: Record<string, string | number | null>
      rowCount: number
      truncated?: boolean
      note?: string
    }
  | {
      type: 'import_leads'
      imported: number
      skipped: number
      message?: string
      preview?: unknown
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function extractDiaActions(toolCalls: ToolCallRecord[]): DiaActionCard[] {
  const actions: DiaActionCard[] = []

  for (const tc of toolCalls) {
    if (!tc.allowed || tc.error) continue
    const out = asRecord(tc.output)
    if (!out) continue

    if (tc.confirmToken && out.needsConfirmation === true) {
      actions.push({
        type: 'confirm_action',
        tool: tc.toolName,
        title: String(out.title ?? tc.toolName),
        lines: Array.isArray(out.lines)
          ? (out.lines as Array<Record<string, unknown>>).map(l => ({ label: String(l.label ?? ''), value: String(l.value ?? '') }))
          : [],
        warnings: Array.isArray(out.warnings) ? out.warnings.map(String) : undefined,
        token: tc.confirmToken,
      })
      continue
    }

    if (tc.toolName === 'run_report' && out.ok === true && Array.isArray(out.columns) && Array.isArray(out.rows)) {
      actions.push({
        type: 'report',
        title: String(out.title ?? 'Report'),
        period: asRecord(out.period) as { from: string; to: string } | undefined,
        filters: (asRecord(out.filters) ?? {}) as Record<string, string>,
        columns: out.columns.map(String),
        rows: out.rows as Array<Record<string, string | number | null>>,
        totals: (asRecord(out.totals) ?? {}) as Record<string, string | number | null>,
        rowCount: Number(out.rowCount) || 0,
        truncated: out.truncated === true,
        note: typeof out.note === 'string' ? out.note : undefined,
      })
      continue
    }

    if (tc.toolName === 'draft_message') {
      const draft = asRecord(out.draftMessage) ?? out
      const channel = draft.channel === 'email' || draft.channel === 'whatsapp' ? draft.channel : null
      const body = typeof draft.body === 'string' ? draft.body : ''
      if (channel && body) {
        actions.push({
          type: 'draft_message',
          channel,
          subject: typeof draft.subject === 'string' ? draft.subject : undefined,
          body,
          recipientName: typeof draft.recipientName === 'string' ? draft.recipientName : undefined,
        })
      }
      continue
    }

    if (tc.toolName === 'draft_quotation') {
      const draftQuote = asRecord(out.draftQuote)
      if (out.ok === false || !draftQuote) continue
      const lines = Array.isArray(draftQuote.lines) ? draftQuote.lines : []
      actions.push({
        type: 'draft_quotation',
        companyName: String(draftQuote.companyName || 'Customer'),
        clientId: String(draftQuote.clientId || draftQuote.companyId || ''),
        totalAmount: Number(draftQuote.totalAmount) || 0,
        lineCount: lines.length,
        notes: (draftQuote.notes as string | null | undefined) ?? null,
        draftQuote,
      })
      continue
    }

    if (tc.toolName === 'import_sales_inbox_leads') {
      actions.push({
        type: 'import_leads',
        imported: Number(out.imported ?? out.created ?? out.count ?? 0) || 0,
        skipped: Number(out.skipped ?? 0) || 0,
        message: typeof out.message === 'string' ? out.message : undefined,
        preview: out.preview ?? out.leads ?? undefined,
      })
    }
  }

  return actions
}
