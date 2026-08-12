/**
 * Server VAT control from posted journal lines (Finance Phase 6).
 */

import 'server-only'
import {
  aggregateJournalLines,
  fetchPostedLines,
} from '@/lib/accounting/gl-reports'
import {
  buildVatControlFromAggregates,
  buildVatReturnDraft,
  type VatControlResult,
  type VatReturnDraft,
} from '@/lib/accounting/vat-reports'

export async function buildVatControlReport(opts?: {
  dateFrom?: string
  dateTo?: string
}): Promise<VatControlResult> {
  const lines = await fetchPostedLines({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  })
  const aggregates = aggregateJournalLines(lines)
  return buildVatControlFromAggregates(aggregates, {
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
  })
}

export async function buildVatReturnDraftReport(opts?: {
  dateFrom?: string
  dateTo?: string
  periodLabel?: string
  companyPin?: string | null
  vatNumber?: string | null
}): Promise<{ control: VatControlResult; draft: VatReturnDraft }> {
  const control = await buildVatControlReport({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  })
  const draft = buildVatReturnDraft(control, {
    periodLabel: opts?.periodLabel,
    companyPin: opts?.companyPin,
    vatNumber: opts?.vatNumber,
  })
  return { control, draft }
}
