import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createFixedAsset, listFixedAssets } from '@/lib/accounting/fixed-asset-service'

export const dynamic = 'force-dynamic'

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
    const body = await request.json().catch(() => ({}))
    const assetNumber = String(body.assetNumber || '').trim()
    const name = String(body.name || '').trim()
    const assetClass = String(body.assetClass || 'furniture').trim()
    const acquisitionDate = String(body.acquisitionDate || '').trim()
    const acquisitionCost = Number(body.acquisitionCost)
    const usefulLifeMonths = Math.round(Number(body.usefulLifeMonths) || 0)
    if (!assetNumber || !name || !acquisitionDate || !(acquisitionCost > 0) || usefulLifeMonths <= 0) {
      return NextResponse.json({ error: 'assetNumber, name, acquisitionDate, acquisitionCost, usefulLifeMonths required' }, { status: 400 })
    }
    const result = await createFixedAsset({
      assetNumber,
      name,
      assetClass,
      acquisitionDate,
      acquisitionCost,
      residualValue: body.residualValue != null ? Number(body.residualValue) : 0,
      usefulLifeMonths,
      depreciationMethod: body.depreciationMethod ? String(body.depreciationMethod) : 'straight_line',
      createdById: actor.id,
    })
    return NextResponse.json(result, { status: 201 })
  })
}
