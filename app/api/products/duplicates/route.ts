import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import {
  listDuplicateProductGroups,
  mergeDuplicateProducts,
  mergeObviousDuplicateProducts,
} from '@/lib/inventory/merge-duplicate-products'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const groups = await listDuplicateProductGroups()
    return NextResponse.json({ groups })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    let body: { keepId?: string; dropId?: string; obvious?: boolean; dryRun?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (body.obvious) {
      const result = await mergeObviousDuplicateProducts({ dryRun: Boolean(body.dryRun) })
      return NextResponse.json(result)
    }
    if (!body.keepId || !body.dropId) {
      return NextResponse.json({ error: 'keepId and dropId are required' }, { status: 400 })
    }
    const result = await mergeDuplicateProducts({ keepId: body.keepId, dropId: body.dropId })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
    return NextResponse.json(result)
  })
}
