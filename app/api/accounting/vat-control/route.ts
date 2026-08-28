import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildVatReturnFromTaxLedger } from '@/lib/accounting/vat-reports.server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/accounting/vat-control
 * Statutory VAT return from tax_transactions, with GL 3301/1150 as a control cross-check.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined
    const taxPeriod = searchParams.get('taxPeriod') || undefined
    const includeDraft = searchParams.get('draft') === '1' || searchParams.get('draft') === 'true'

    let companyPin: string | null = null
    let vatNumber: string | null = null
    if (includeDraft) {
      try {
        const company = await prisma.companySetting.findFirst({
          select: { kraPin: true, vatNumber: true },
        })
        companyPin = company?.kraPin ?? null
        vatNumber = company?.vatNumber ?? null
      } catch {
        /* optional */
      }
    }

    const report = await buildVatReturnFromTaxLedger({
      dateFrom,
      dateTo,
      taxPeriod,
      companyPin,
      vatNumber,
    })

    return NextResponse.json(report)
  })
}
