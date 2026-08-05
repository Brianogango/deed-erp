import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { approvalSchema } from '@/lib/reconfiguration/schemas'
import { rejectWorkOrder } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/reject
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('approveReconfiguration')
    const body = await request.json()
    const parsed = approvalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await rejectWorkOrder({
      id: params.id,
      version: parsed.data.version,
      reason: parsed.data.reason,
      userId: user.id,
    })
    return NextResponse.json(order)
  })
}
