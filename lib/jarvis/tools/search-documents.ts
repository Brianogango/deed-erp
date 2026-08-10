import 'server-only'

import { z } from 'zod'
import { retrieveKnowledge } from '../knowledge'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(10).optional(),
})

// Postgres full-text search over ingested website/SOP/policy documents.
// content_tsv is maintained by prisma/migrations/004_jarvis_ai_layer.sql.
export const searchDocumentsTool: ToolDefinition = {
  name: 'search_documents',
  description:
    'Search ingested company knowledge (website pages/policies, SOPs) for passages relevant to a question. Returns cited excerpts — answer policy/product/process questions only using what this returns. Prefer this for warranty policy, returns, reconfiguration process, and similar.',
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
    const passages = await retrieveKnowledge(query, limit ?? 5)

    if (passages.length === 0) {
      return {
        found: false,
        message: 'No matching passages were found in the ingested company knowledge for this query.',
      }
    }

    return {
      found: true,
      passages: passages.map(r => ({
        chunkId: r.chunkId,
        documentTitle: r.title,
        sourceType: r.sourceType,
        sourceUrl: r.sourceUrl,
        category: r.category,
        updatedAt: r.updatedAt,
        excerpt: r.excerpt,
      })),
    }
  },
}
