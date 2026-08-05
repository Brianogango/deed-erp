import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { patchDraftSchema } from '@/lib/reconfiguration/schemas'
import {
  applyTargetToWorkOrder,
  getWorkOrder,
} from '@/lib/reconfiguration/service'
import { assertVersion, isMutableDraftStatus } from '@/lib/reconfiguration/state-machine'

/**
 * GET /api/reconfiguration/[id]
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requirePermission('viewReconfiguration')
    const order = await getWorkOrder(params.id)
    return NextResponse.json(order)
  })
}

/**
 * PATCH /api/reconfiguration/[id]
 * Edit draft fields; optionally re-apply target configuration.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editReconfigurationDraft')
    const body = await request.json()
    const parsed = patchDraftSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const data = parsed.data
    const wo = await getWorkOrder(params.id)
    assertVersion(wo.version, data.version)

    if (!isMutableDraftStatus(wo.status as any) && wo.status !== 'components_reserved') {
      const err = new Error('Work order can only be edited in draft/stock-check states') as Error & {
        status: number
      }
      err.status = 422
      throw err
    }

    if (data.target) {
      await applyTargetToWorkOrder(params.id, data.target, user.id)
    }

    const patch: Record<string, unknown> = { updatedById: user.id }
    if (data.reason !== undefined) patch.reason = data.reason
    if (data.notes !== undefined) patch.notes = data.notes
    if (data.transactionType !== undefined) patch.transactionType = data.transactionType
    if (data.labourCost !== undefined) patch.labourCost = data.labourCost
    if (data.otherCost !== undefined) patch.otherCost = data.otherCost
    if (data.technicianId !== undefined) patch.technicianId = data.technicianId
    if (data.priceMethod !== undefined) patch.priceMethod = data.priceMethod
    if (data.finalSellingPrice !== undefined) patch.finalSellingPrice = data.finalSellingPrice

    const hasPatch = Object.keys(patch).length > 1 // beyond updatedById
    if (hasPatch) {
      if (!data.target) {
        patch.version = { increment: 1 }
      }
      await prisma.reconfigurationWorkOrder.update({
        where: { id: params.id },
        data: patch,
      })
    }

    return NextResponse.json(await getWorkOrder(params.id))
  })
}
