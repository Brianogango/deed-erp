import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { buildVatReturnDraftReport } from '@/lib/accounting/vat-reports.server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/accounting/vat-control?dateFrom=&dateTo=
 * Read-only VAT control from posted journal lines on 3301 / 1150.
 */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined
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
        /* company settings optional */
      }
    }

    const { control, draft } = await buildVatReturnDraftReport({
      dateFrom,
      dateTo,
      companyPin,
      vatNumber,
    })

    return NextResponse.json(includeDraft ? { ...control, draft } : control)
  })
}
