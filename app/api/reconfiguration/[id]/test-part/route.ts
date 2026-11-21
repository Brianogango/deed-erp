import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { recordPulledPartTest } from '@/lib/reconfiguration/bench-complete'

const schema = z.object({ lineId: z.string().uuid(), passed: z.boolean() })

/**
 * POST /api/reconfiguration/[id]/test-part
 * A pulled part tested: passed goes to shelf stock, failed to quarantine.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('completeReconfiguration')
    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }
    const order = await recordPulledPartTest({ workOrderId: id, lineId: parsed.data.lineId, passed: parsed.data.passed, userId: user.id })
    return NextResponse.json(order)
  })
}
