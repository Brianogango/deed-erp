import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(10).optional(),
})

interface ChunkRow {
  chunk_id: string
  document_id: string
  title: string
  content: string
  rank: number
}

// Postgres full-text search over ingested SOP/policy documents. The
// content_tsv column + GIN index are created by
// prisma/migrations/004_jarvis_ai_layer.sql (not declared in schema.prisma,
// so this query goes through $queryRaw rather than the typed client).
export const searchDocumentsTool: ToolDefinition = {
  name: 'search_documents',
  description:
    'Search ingested company SOPs/policy documents for passages relevant to a question. Returns cited excerpts — answer policy/product questions only using what this returns.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question or topic to search for' },
      limit: { type: 'number', description: 'Max passages to return (default 5, max 10)' },
    },
    required: ['query'],
  },
  requiredModule: null,
  requiredPermission: null,
  mutates: false,
  run: async (_ctx, rawInput) => {
    const { query, limit } = inputSchema.parse(rawInput)
    const take = limit ?? 5

    const rows = await prisma.$queryRaw<ChunkRow[]>`
      SELECT
        c.id AS chunk_id,
        c.document_id AS document_id,
        d.title AS title,
        c.content AS content,
        ts_rank(c.content_tsv, websearch_to_tsquery('english', ${query})) AS rank
      FROM ai_document_chunks c
      JOIN ai_documents d ON d.id = c.document_id
      WHERE c.content_tsv @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${take}
    `

    if (rows.length === 0) {
      return {
        found: false,
        message: 'No matching passages were found in the ingested company documents for this query.',
      }
    }

    return {
      found: true,
      passages: rows.map(r => ({
        documentTitle: r.title,
        excerpt: r.content.slice(0, 1200),
      })),
    }
  },
}
