import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { recordRemovalSchema } from '@/lib/reconfiguration/schemas'
import { recordRemoval } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/record-removal
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('performReconfigRemoval')
    const body = await request.json()
    const parsed = recordRemovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await recordRemoval({
      id: params.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
