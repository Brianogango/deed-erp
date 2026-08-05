import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { targetConfigSchema } from '@/lib/reconfiguration/schemas'
import { applyTargetToWorkOrder, getWorkOrder } from '@/lib/reconfiguration/service'

const applyTargetSchema = z.object({
  target: targetConfigSchema,
  version: z.number().int().min(1).optional(),
})

/**
 * POST /api/reconfiguration/[id]/apply-target
 * Apply a target configuration to the work order (rebuilds diff lines).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editReconfigurationDraft')
    const body = await request.json()
    const parsed = applyTargetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // Ensure WO exists (and version matches when provided)
    const wo = await getWorkOrder(params.id)
    if (parsed.data.version != null && wo.version !== parsed.data.version) {
      const err = new Error(
        'Work order was modified by another user. Reload and try again.',
      ) as Error & { status: number }
      err.status = 409
      throw err
    }

    await applyTargetToWorkOrder(params.id, parsed.data.target, user.id)
    return NextResponse.json(await getWorkOrder(params.id))
  })
}
