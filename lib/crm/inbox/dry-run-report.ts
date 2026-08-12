/**
 * Historical / sample dry-run report for sales@ mailbox (no CRM mutations).
 */

import 'server-only'
import { processSalesInboxLeads, type SalesInboxProcessResult } from '@/lib/crm/sales-inbox-process'
import { resolveSalesInboxPipelineConfig } from '@/lib/crm/inbox/config'
import { salesInboxAiClassifierEnabled } from '@/lib/crm/inbox/classify-ai'

export interface SalesInboxDryRunReport {
  generatedAt: string
  mode: string
  aiClassifier: boolean
  lookbackHours: number
  limit: number
  summary: {
    fetched: number
    wouldCreate: number
    wouldReview: number
    wouldLink: number
    wouldSkipHard: number
    wouldSkipNonSales: number
    duplicates: number
    errors: string[]
  }
  byDecision: Record<string, number>
  samples: SalesInboxProcessResult['createdLeads']
  raw: SalesInboxProcessResult
}

export async function generateSalesInboxDryRunReport(opts?: {
  limit?: number
  lookbackHours?: number
}): Promise<SalesInboxDryRunReport> {
  const config = resolveSalesInboxPipelineConfig()
  const lookbackHours = Math.min(24 * 30, Math.max(1, opts?.lookbackHours ?? 72))
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50))

  const raw = await processSalesInboxLeads({
    limit,
    lookbackHours,
    includeRecentSeen: true,
    dryRun: true,
    skipLock: true,
  })

  const byDecision: Record<string, number> = {}
  for (const lead of raw.createdLeads) {
    const key = lead.decision || lead.disposition || 'unknown'
    byDecision[key] = (byDecision[key] || 0) + 1
  }
  byDecision.HARD_FILTERED = (byDecision.HARD_FILTERED || 0) + raw.skipped
  byDecision.NON_SALES = (byDecision.NON_SALES || 0) + raw.nonSales
  byDecision.LINK_EXISTING_LEAD = (byDecision.LINK_EXISTING_LEAD || 0) + raw.linked
  byDecision.DUPLICATE = (byDecision.DUPLICATE || 0) + raw.duplicates

  return {
    generatedAt: new Date().toISOString(),
    mode: config.mode,
    aiClassifier: salesInboxAiClassifierEnabled(),
    lookbackHours,
    limit,
    summary: {
      fetched: raw.fetched,
      wouldCreate: raw.created - raw.reviewQueued,
      wouldReview: raw.reviewQueued,
      wouldLink: raw.linked,
      wouldSkipHard: raw.skipped,
      wouldSkipNonSales: raw.nonSales,
      duplicates: raw.duplicates,
      errors: raw.errors,
    },
    byDecision,
    samples: raw.createdLeads.slice(0, 30),
    raw,
  }
}
