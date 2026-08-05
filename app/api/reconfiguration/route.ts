import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { createReconfigSchema } from '@/lib/reconfiguration/schemas'
import { createReconfiguration, listWorkOrders } from '@/lib/reconfiguration/service'

/**
 * GET /api/reconfiguration
 * List reconfiguration work orders (optional status, q filters).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('viewReconfiguration')
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const q = searchParams.get('q') || undefined
    const orders = await listWorkOrders({ status, q })
    return NextResponse.json(orders)
  })
}

/**
 * POST /api/reconfiguration
 * Create a reconfiguration work order.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('createReconfiguration')
    const body = await request.json()
    const parsed = createReconfigSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await createReconfiguration({
      ...parsed.data,
      userId: user.id,
    })
    return NextResponse.json(order, { status: 201 })
  })
}
