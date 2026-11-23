import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { reverseBenchJob } from '@/lib/reconfiguration/bench-complete'

const schema = z.object({ reason: z.string().min(1).max(2000) })

/**
 * POST /api/reconfiguration/[id]/reverse
 * Reverse a completed job: parts back, old specs, cost and price, stock value entry reversed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('reverseReconfiguration')
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }
    const order = await reverseBenchJob(id, user.id, parsed.data.reason)
    return NextResponse.json(order)
  })
}
