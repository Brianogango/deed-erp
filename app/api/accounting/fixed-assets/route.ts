import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createFixedAsset, listFixedAssets } from '@/lib/accounting/fixed-asset-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const fixedAssetCreateSchema = z.object({
  assetNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(240),
  assetClass: z.string().trim().min(1).max(40).default('furniture'),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acquisitionCost: z.coerce.number().finite().positive().max(99_999_999_999.99),
  residualValue: z.coerce.number().finite().nonnegative().max(99_999_999_999.99).default(0),
  usefulLifeMonths: z.coerce.number().int().positive().max(1200),
  depreciationMethod: z.enum(['straight_line', 'reducing_balance']).default('straight_line'),
}).strict().refine(v => v.residualValue <= v.acquisitionCost, {
  message: 'Residual value cannot exceed acquisition cost', path: ['residualValue'],
})

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const assets = await listFixedAssets()
    return NextResponse.json({ assets })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const parsed = fixedAssetCreateSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid fixed asset', issues: parsed.error.issues }, { status: 422 })
    }
    const body = parsed.data
    const acquisition = new Date(`${body.acquisitionDate}T00:00:00Z`)
    if (Number.isNaN(acquisition.getTime())) {
      return NextResponse.json({ error: 'Invalid acquisition date' }, { status: 422 })
    }
    const result = await createFixedAsset({
      assetNumber: body.assetNumber,
      name: body.name,
      assetClass: body.assetClass,
      acquisitionDate: body.acquisitionDate,
      acquisitionCost: body.acquisitionCost,
      residualValue: body.residualValue,
      usefulLifeMonths: body.usefulLifeMonths,
      depreciationMethod: body.depreciationMethod,
      createdById: actor.id,
    })
    return NextResponse.json(result, { status: 201 })
  })
}
