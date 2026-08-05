import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { cancelSchema } from '@/lib/reconfiguration/schemas'
import { cancelWorkOrder } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/cancel
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editReconfigurationDraft')
    const body = await request.json()
    const parsed = cancelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await cancelWorkOrder({
      id: params.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
