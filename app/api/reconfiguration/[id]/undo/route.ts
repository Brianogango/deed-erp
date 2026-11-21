import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { undoStuckBenchJob } from '@/lib/reconfiguration/bench-complete'

const schema = z.object({ reason: z.string().max(2000).optional() })

/**
 * POST /api/reconfiguration/[id]/undo
 * A bench job that stopped half-way: put back every part that moved and cancel it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('createReconfiguration')
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }
    const order = await undoStuckBenchJob(id, user.id, parsed.data.reason?.trim() || undefined)
    return NextResponse.json(order)
  })
}
