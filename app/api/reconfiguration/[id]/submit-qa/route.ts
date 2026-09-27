import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { submitQaSchema } from '@/lib/reconfiguration/schemas'
import { submitQa } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/submit-qa
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('completeReconfigQa')
    const body = await request.json()
    const parsed = submitQaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await submitQa({
      id: resolvedParams.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
