import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { startWork } from '@/lib/reconfiguration/service'

const startSchema = z.object({
  version: z.number().int().min(1),
})

/**
 * POST /api/reconfiguration/[id]/start
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('performReconfigInstallation')
    const body = await request.json()
    const parsed = startSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await startWork({
      id: params.id,
      version: parsed.data.version,
      userId: user.id,
    })
    return NextResponse.json(order)
  })
}
