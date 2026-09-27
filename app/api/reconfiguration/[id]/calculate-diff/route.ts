import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { targetConfigSchema } from '@/lib/reconfiguration/schemas'
import {
  calculateDiffForDevice,
  getWorkOrder,
} from '@/lib/reconfiguration/service'

const calculateDiffSchema = z.object({
  target: targetConfigSchema,
})

/**
 * POST /api/reconfiguration/[id]/calculate-diff
 * Proposed vs current configuration for this work order's device.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    await requirePermission('viewReconfiguration')
    const body = await request.json()
    const parsed = calculateDiffSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const wo = await getWorkOrder(resolvedParams.id)
    const result = await calculateDiffForDevice({
      serialId: wo.serialId,
      target: parsed.data.target,
    })
    return NextResponse.json(result)
  })
}
