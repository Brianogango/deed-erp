import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  source: z.enum(['inbound_email', 'all']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().min(1).max(30).optional(),
})

/**
 * Read-only CRM lead summary — especially inbound leads created from sales@ emails.
 */
export const summarizeSalesLeadsTool: ToolDefinition = {
  name: 'summarize_sales_leads',
  description:
    'List/count CRM leads. Use source=inbound_email for leads created from sales@deed.co.ke inbox emails. Does not open the mailbox — only shows leads already in the ERP.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['inbound_email', 'all'],
        description: 'Filter by lead source. inbound_email = created from sales@ inbox.',
      },
      fromDate: { type: 'string', description: 'Inclusive start date YYYY-MM-DD (Nairobi calendar day)' },
      toDate: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
      limit: { type: 'number', description: 'Max leads to return in the sample list (default 15, max 30)' },
    },
  },
  requiredModule: 'crm',
  requiredPermission: null,
  mutates: false,
  run: async (ctx, rawInput) => {
    const { source, fromDate, toDate, limit } = inputSchema.parse(rawInput ?? {})
    const take = limit ?? 15

    const createdAt: { gte?: Date; lt?: Date } = {}
    if (fromDate) createdAt.gte = new Date(`${fromDate}T00:00:00+03:00`)
    if (toDate) {
      const end = new Date(`${toDate}T00:00:00+03:00`)
      end.setDate(end.getDate() + 1)
      createdAt.lt = end
    }

    const where: Record<string, unknown> = {}
    if (Object.keys(createdAt).length > 0) where.createdAt = createdAt
    if (source === 'inbound_email') {
      where.OR = [
        { source: 'inbound_email' },
        { inboundMessageId: { not: null } },
      ]
    }

    // Sales reps only see their own leads; directors/admins see all.
    if (ctx.user.role === 'sales_rep') {
      where.ownerId = ctx.user.id
    }

    const [total, byStage, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.groupBy({
        by: ['stage'],
        where,
        _count: { _all: true },
      }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          name: true,
          companyName: true,
          email: true,
          phone: true,
          source: true,
          stage: true,
          inboundMessageId: true,
          createdAt: true,
          owner: { select: { id: true, name: true, username: true } },
        },
      }),
    ])

    return {
      total,
      sourceFilter: source ?? 'all',
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
      byStage: Object.fromEntries(byStage.map(r => [r.stage, r._count._all])),
      leads: leads.map(l => ({
        id: l.id,
        name: l.name,
        companyName: l.companyName,
        email: l.email,
        phone: l.phone,
        source: l.source,
        stage: l.stage,
        fromSalesInbox: Boolean(l.inboundMessageId) || l.source === 'inbound_email',
        ownerName: l.owner?.name ?? l.owner?.username ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
      hint: 'Open CRM → Leads for full detail. To pull new messages from sales@ now, use import_sales_inbox_leads.',
    }
  },
}
