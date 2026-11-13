import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import {
  findDuplicateContactGroups,
  mergeDuplicateContacts,
  mergeObviousDuplicateContacts,
} from '@/lib/crm/inbox/duplicate-contacts'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('sales.crm.view_duplicates')
    const groups = await findDuplicateContactGroups({ limit: 50 })
    return NextResponse.json({ groups })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('sales.crm.merge_duplicates')
    const body = await request.json() as {
      action?: string
      keepId?: string
      mergeId?: string
    }
    if (body.action === 'mergeObvious') {
      const result = await mergeObviousDuplicateContacts()
      return NextResponse.json(result)
    }
    if (!body.keepId || !body.mergeId) {
      return NextResponse.json({ error: 'keepId and mergeId required' }, { status: 400 })
    }
    const result = await mergeDuplicateContacts({
      keepId: body.keepId,
      mergeId: body.mergeId,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json(result)
  })
}
