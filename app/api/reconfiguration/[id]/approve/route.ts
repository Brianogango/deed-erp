import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { approvalSchema } from '@/lib/reconfiguration/schemas'
import { approveWorkOrder } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/approve
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

    if (parsed.data.compatibilityOverride) {
      await requirePermission('overrideReconfigCompatibility')
    }
    if (parsed.data.marginOverride) {
      await requirePermission('overrideMinimumMargin')
    }

    const order = await approveWorkOrder({
      id: params.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
