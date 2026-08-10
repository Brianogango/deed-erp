import 'server-only'

import prisma from '@/lib/prisma'

/** Minimal tool-call shape for source attribution (avoids circular imports). */
export interface ToolCallForSources {
  toolName: string
  allowed: boolean
  output?: unknown
}

export interface KnowledgePassage {
  chunkId: string
  documentId: string
  title: string
  excerpt: string
  sourceType: string
  sourceUrl: string | null
  category: string | null
  updatedAt: string | null
  rank: number
}

export interface AnswerSource {
  label: string
  kind: 'live' | 'knowledge'
  detail?: string | null
  url?: string | null
  updatedAt?: string | null
  toolName?: string
}

interface ChunkRow {
  chunk_id: string
  document_id: string
  title: string
  content: string
  source_type: string
  source_url: string | null
  category: string | null
  updated_at: Date | null
  rank: number
}

const LIVE_TOOL_LABELS: Record<string, string> = {
  search_customers: 'Customers',
  check_inventory: 'Inventory',
  explain_invoice: 'Invoice',
  track_repair: 'Repair',
  check_warranty: 'Warranty',
  summarize_sales: 'Sales',
  summarize_repairs: 'Repairs',
  overdue_payments: 'Payments',
  procurement_summary: 'Purchasing',
  draft_quotation: 'Quotation draft',
  draft_message: 'Message draft',
  search_documents: 'Documents',
}

function sourceTypeLabel(sourceType: string): string {
  if (sourceType === 'website') return 'Website'
  if (sourceType === 'sop') return 'SOP'
  if (sourceType === 'my_document') return 'Document'
  return sourceType
}

/**
 * Postgres FTS retrieval over ingested knowledge (website, SOPs, policies).
 * Used for auto-RAG at question time and by the search_documents tool.
 */
export async function retrieveKnowledge(query: string, limit = 5): Promise<KnowledgePassage[]> {
  const q = query.trim()
  if (!q) return []
  const take = Math.min(Math.max(limit, 1), 10)

  try {
    const rows = await prisma.$queryRaw<ChunkRow[]>`
      SELECT
        c.id AS chunk_id,
        c.document_id AS document_id,
        d.title AS title,
        c.content AS content,
        d.source_type AS source_type,
        d.source_url AS source_url,
        d.category AS category,
        d.updated_at AS updated_at,
        ts_rank(c.content_tsv, websearch_to_tsquery('english', ${q})) AS rank
      FROM ai_document_chunks c
      JOIN ai_documents d ON d.id = c.document_id
      WHERE d.status = 'ready'
        AND c.content_tsv @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT ${take}
    `

    return rows.map(r => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      excerpt: r.content.slice(0, 1200),
      sourceType: r.source_type,
      sourceUrl: r.source_url,
      category: r.category,
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      rank: Number(r.rank),
    }))
  } catch (err) {
    console.error('[jarvis] retrieveKnowledge failed:', err)
    return []
  }
}

export function formatKnowledgeForPrompt(passages: KnowledgePassage[]): string {
  if (passages.length === 0) return ''
  const blocks = passages.map((p, i) => {
    const meta = [
      `title=${p.title}`,
      `type=${p.sourceType}`,
      p.sourceUrl ? `url=${p.sourceUrl}` : null,
      p.updatedAt ? `updated=${p.updatedAt.slice(0, 10)}` : null,
    ].filter(Boolean).join(' · ')
    return `[${i + 1}] (${meta})\n${p.excerpt}`
  })
  return [
    'Retrieved knowledge passages (cite by title when using these; do not invent beyond them):',
    ...blocks,
  ].join('\n\n')
}

function liveDetailFromOutput(toolName: string, output: unknown): string | null {
  if (!output || typeof output !== 'object') return null
  const o = output as Record<string, unknown>
  if (toolName === 'track_repair') {
    const job = o.jobNumber ?? o.repairJobNumber ?? o.job_number
    if (typeof job === 'string' && job.trim()) return job.trim()
  }
  if (toolName === 'explain_invoice') {
    const num = o.invoiceNumber ?? o.number
    if (typeof num === 'string' && num.trim()) return num.trim()
  }
  if (toolName === 'check_inventory' && typeof o.count === 'number') {
    return `${o.count} product(s)`
  }
  return null
}

/**
 * Build UI/API source chips from auto-retrieved passages + successful tool calls.
 */
export function buildAnswerSources(
  passages: KnowledgePassage[],
  toolCalls: ToolCallForSources[],
): AnswerSource[] {
  const sources: AnswerSource[] = []
  const seen = new Set<string>()

  for (const tc of toolCalls) {
    if (!tc.allowed || tc.toolName === 'search_documents') continue
    const label = LIVE_TOOL_LABELS[tc.toolName] ?? tc.toolName
    const detail = liveDetailFromOutput(tc.toolName, tc.output)
    const key = `live:${tc.toolName}:${detail ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      label,
      kind: 'live',
      detail,
      toolName: tc.toolName,
    })
  }

  for (const tc of toolCalls) {
    if (!tc.allowed || tc.toolName !== 'search_documents') continue
    const out = tc.output as { passages?: Array<Record<string, unknown>> } | undefined
    for (const p of out?.passages ?? []) {
      const title = typeof p.documentTitle === 'string' ? p.documentTitle : 'Document'
      const key = `knowledge:${title}:${String(p.sourceUrl ?? '')}`
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({
        label: title,
        kind: 'knowledge',
        detail: typeof p.sourceType === 'string' ? sourceTypeLabel(p.sourceType) : 'Document',
        url: typeof p.sourceUrl === 'string' ? p.sourceUrl : null,
        updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
        toolName: 'search_documents',
      })
    }
  }

  for (const p of passages) {
    const key = `knowledge:${p.title}:${p.sourceUrl ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({
      label: p.title,
      kind: 'knowledge',
      detail: sourceTypeLabel(p.sourceType),
      url: p.sourceUrl,
      updatedAt: p.updatedAt,
    })
  }

  return sources.slice(0, 8)
}
