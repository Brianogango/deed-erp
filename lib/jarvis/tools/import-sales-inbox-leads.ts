import 'server-only'

import { z } from 'zod'
import {
  processSalesInboxLeads,
  salesInboxConfigured,
} from '@/lib/crm/sales-inbox-process'
import type { ToolDefinition } from '../types'

const inputSchema = z.object({
  dryRun: z.boolean().optional(),
  lookbackHours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  includeRecentSeen: z.boolean().optional(),
})

/**
 * Poll sales@ IMAP and create CRM leads (same path as the 5-minute cron).
 * Controlled write — audited via runTool; does not send email.
 */
export const importSalesInboxLeadsTool: ToolDefinition = {
  name: 'import_sales_inbox_leads',
  description:
    'Poll the sales@deed.co.ke mailbox via IMAP and create CRM leads from new customer emails (skips junk/noise/blocklists, queues weak mail as needs_review without paging sales, accepts RFQ-shaped mail with assign+notify, dedupes by Message-ID). Use when the user asks to import/create leads from sales emails or check the inbox for new leads. Set dryRun=true to preview without creating. A background cron also runs this every 5 minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      dryRun: {
        type: 'boolean',
        description: 'If true, report what would be created without writing leads (default false)',
      },
      lookbackHours: {
        type: 'number',
        description: 'How far back to scan when includeRecentSeen is used (default from server, max 168)',
      },
      limit: {
        type: 'number',
        description: 'Max emails to process this run (default server limit, max 50)',
      },
      includeRecentSeen: {
        type: 'boolean',
        description: 'Also re-scan recently seen messages in the lookback window (default false)',
      },
    },
  },
  requiredModule: 'crm',
  requiredPermission: null,
  mutates: true,
  run: async (_ctx, rawInput) => {
    const input = inputSchema.parse(rawInput ?? {})

    if (!salesInboxConfigured()) {
      return {
        ok: false,
        configured: false,
        error: 'Sales IMAP is not configured on this server',
        hint: 'Set SALES_IMAP_PASS (or SALES_SMTP_PASS) for sales@deed.co.ke on Contabo',
      }
    }

    const result = await processSalesInboxLeads({
      dryRun: input.dryRun === true,
      lookbackHours: input.lookbackHours,
      limit: input.limit,
      includeRecentSeen: input.includeRecentSeen === true,
    })

    return {
      ok: result.errors.length === 0 || result.created > 0,
      dryRun: input.dryRun === true,
      mailbox: process.env.SALES_EMAIL || process.env.SALES_IMAP_USER || 'sales@deed.co.ke',
      configured: result.configured,
      autoAssign: result.autoAssign,
      fetched: result.fetched,
      created: result.created,
      skipped: result.skipped,
      reviewQueued: result.reviewQueued,
      duplicates: result.duplicates,
      errors: result.errors.slice(0, 10),
      createdLeads: result.createdLeads.slice(0, 20),
      crmPath: '/crm?tab=leads',
      note: result.created > 0
        ? (input.dryRun
          ? 'Dry run only — no leads were written.'
          : 'Leads were created in CRM. RFQ-shaped leads notify the assigned owner; weak mail is parked as Needs review.')
        : 'No new creatable messages in this poll (empty inbox window, skips, or duplicates).',
    }
  },
}
