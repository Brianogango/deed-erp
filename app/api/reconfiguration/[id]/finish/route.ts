import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { finishStuckBenchJob } from '@/lib/reconfiguration/bench-complete'

const schema = z.object({})

/**
 * POST /api/reconfiguration/[id]/finish
 * A bench job that stopped half-way: move the parts still owed, then finish.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('createReconfiguration')
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }
    const order = await finishStuckBenchJob(id, user.id)
    return NextResponse.json(order)
  })
}
