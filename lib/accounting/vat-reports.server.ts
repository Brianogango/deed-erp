import 'server-only'
import prisma from '@/lib/prisma'
import { buildStatutoryVatReturn } from '@/lib/accounting/vat-tax-ledger'
import {
  aggregateJournalLines,
  fetchPostedLines,
} from '@/lib/accounting/gl-reports'
import {
  buildVatControlFromAggregates,
  buildVatReturnDraft,
} from '@/lib/accounting/vat-reports'

function periodBounds(taxPeriod?: string, dateFrom?: string, dateTo?: string) {
  if (taxPeriod && /^\d{4}-\d{2}$/.test(taxPeriod)) {
    const [y, m] = taxPeriod.split('-').map(Number)
    const from = `${taxPeriod}-01`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = `${taxPeriod}-${String(last).padStart(2, '0')}`
    return { dateFrom: dateFrom || from, dateTo: dateTo || to, taxPeriod }
  }
  return { dateFrom, dateTo, taxPeriod: taxPeriod || null }
}

export async function buildVatReturnFromTaxLedger(opts?: {
  dateFrom?: string
  dateTo?: string
  taxPeriod?: string
  companyPin?: string | null
  vatNumber?: string | null
}) {
  const bounds = periodBounds(opts?.taxPeriod, opts?.dateFrom, opts?.dateTo)
  const where: Record<string, unknown> = {}
  if (bounds.taxPeriod) where.taxPeriod = bounds.taxPeriod
  if (bounds.dateFrom || bounds.dateTo) {
    const taxPoint: Record<string, Date> = {}
    if (bounds.dateFrom) taxPoint.gte = new Date(`${bounds.dateFrom}T00:00:00Z`)
    if (bounds.dateTo) taxPoint.lte = new Date(`${bounds.dateTo}T23:59:59Z`)
    where.taxPoint = taxPoint
  }

  const rows = await prisma.taxTransaction.findMany({
    where,
    select: {
      direction: true,
      taxAmount: true,
      taxableBase: true,
      taxPeriod: true,
      taxPoint: true,
      etimsInvoiceNo: true,
      etimsControlUnitNo: true,
      transmissionStatus: true,
      inputClaimEligible: true,
      withholdingVat: true,
    },
  })

  const statutory = buildStatutoryVatReturn(rows, bounds)

  let glControl = null
  try {
    const lines = await fetchPostedLines({ dateFrom: bounds.dateFrom, dateTo: bounds.dateTo })
    glControl = buildVatControlFromAggregates(aggregateJournalLines(lines), {
      dateFrom: bounds.dateFrom ?? null,
      dateTo: bounds.dateTo ?? null,
    })
  } catch {
    glControl = null
  }

  const draft = buildVatReturnDraft({
    currency: 'KES',
    dateFrom: bounds.dateFrom ?? null,
    dateTo: bounds.dateTo ?? null,
    outputVatCode: 'tax_transactions',
    inputVatCode: 'tax_transactions',
    outputVat: statutory.outputVat,
    inputVat: statutory.inputVat,
    vatPayable: statutory.vatPayable,
    source: 'invoices',
    taxableSales: statutory.taxableSales,
    taxablePurchases: statutory.taxablePurchases,
  }, {
    periodLabel: bounds.taxPeriod || undefined,
    companyPin: opts?.companyPin,
    vatNumber: opts?.vatNumber,
  })

  return {
    ...statutory,
    companyPin: opts?.companyPin ?? null,
    vatNumber: opts?.vatNumber ?? null,
    draft,
    glControl,
    glDifference: glControl
      ? Math.round((statutory.vatPayable - glControl.vatPayable) * 100) / 100
      : null,
  }
}

export async function buildVatControlReport(opts?: {
  dateFrom?: string
  dateTo?: string
}) {
  const lines = await fetchPostedLines({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  })
  return buildVatControlFromAggregates(aggregateJournalLines(lines), {
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
  taxPeriod?: string
}) {
  return buildVatReturnFromTaxLedger({
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
    taxPeriod: opts?.taxPeriod,
    companyPin: opts?.companyPin,
    vatNumber: opts?.vatNumber,
  })
}
