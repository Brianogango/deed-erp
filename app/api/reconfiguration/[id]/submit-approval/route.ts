import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { submitForApproval } from '@/lib/reconfiguration/service'

const submitApprovalSchema = z.object({
  version: z.number().int().min(1),
})

/**
 * POST /api/reconfiguration/[id]/submit-approval
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editReconfigurationDraft')
    const body = await request.json()
    const parsed = submitApprovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await submitForApproval({
      id: params.id,
      version: parsed.data.version,
      userId: user.id,
    })
    return NextResponse.json(order)
  })
}
