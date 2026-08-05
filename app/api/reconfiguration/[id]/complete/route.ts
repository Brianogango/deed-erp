import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { completeSchema } from '@/lib/reconfiguration/schemas'
import { completeWorkOrder } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/complete
 * Idempotent completion.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('completeReconfiguration')
    const body = await request.json()
    const parsed = completeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await completeWorkOrder({
      id: params.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
