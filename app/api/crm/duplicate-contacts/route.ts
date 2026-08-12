import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import {
  findDuplicateContactGroups,
  mergeDuplicateContacts,
} from '@/lib/crm/inbox/duplicate-contacts'

const READ_ROLES = ['director', 'admin_officer', 'sales_rep', 'sales', 'finance_officer', 'super_admin']
const WRITE_ROLES = ['director', 'admin_officer', 'super_admin']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(READ_ROLES)
    const groups = await findDuplicateContactGroups({ limit: 50 })
    return NextResponse.json({ groups })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json() as { keepId?: string; mergeId?: string }
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
