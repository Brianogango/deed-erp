import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { seedInstallationSchema } from '@/lib/reconfiguration/schemas'
import {
  getDeviceConfiguration,
  seedInstalledComponents,
} from '@/lib/reconfiguration/service'

/**
 * GET /api/reconfiguration/device/[serialId]/configuration
 */
export async function GET(
  _request: Request,
  { params }: { params: { serialId: string } },
) {
  return withApiErrorHandling(async () => {
    await requirePermission('viewReconfiguration')
    const config = await getDeviceConfiguration(decodeURIComponent(params.serialId))
    return NextResponse.json(config)
  })
}

/**
 * POST /api/reconfiguration/device/[serialId]/configuration
 * Seed currently installed components for a device.
 */
export async function POST(
  request: Request,
  { params }: { params: { serialId: string } },
) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('editReconfigurationDraft')
    const body = await request.json()
    const serialId = decodeURIComponent(params.serialId)
    const parsed = seedInstallationSchema.safeParse({ ...body, serialId })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result = await seedInstalledComponents({
      serialId,
      userId: user.id,
      components: parsed.data.components,
    })
    return NextResponse.json(result, { status: 201 })
  })
}
