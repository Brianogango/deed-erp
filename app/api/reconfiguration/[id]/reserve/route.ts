import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { reserveSchema } from '@/lib/reconfiguration/schemas'
import { reserveComponents } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/reserve
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('reserveReconfigurationComponents')
    const body = await request.json()
    const parsed = reserveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await reserveComponents({
      id: resolvedParams.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
