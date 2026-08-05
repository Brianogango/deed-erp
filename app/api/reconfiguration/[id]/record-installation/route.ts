import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { recordInstallationSchema } from '@/lib/reconfiguration/schemas'
import { recordInstallation } from '@/lib/reconfiguration/service'

/**
 * POST /api/reconfiguration/[id]/record-installation
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('performReconfigInstallation')
    const body = await request.json()
    const parsed = recordInstallationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    if (parsed.data.overrideReservedComponent) {
      await requirePermission('overrideReconfigStock')
    }

    const order = await recordInstallation({
      id: params.id,
      userId: user.id,
      ...parsed.data,
    })
    return NextResponse.json(order)
  })
}
