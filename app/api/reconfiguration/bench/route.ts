import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { applyBenchSchema } from '@/lib/reconfiguration/schemas'
import { applyBenchAndComplete } from '@/lib/reconfiguration/bench-complete'

/**
 * POST /api/reconfiguration/bench
 * Pull / swap / add RAM and/or SSD and complete in one post.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('createReconfiguration')
    const body = await request.json()
    const parsed = applyBenchSchema.safeParse(body)
    if (!parsed.success) {
      // Name the field, so the bench screen says what to fix instead of a
      // bare "Validation failed".
      const issue = parsed.error.issues[0]
      const where = issue?.path.join('.') || 'request'
      return NextResponse.json(
        { error: `Validation failed: ${where} — ${issue?.message ?? 'invalid value'}`, details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const order = await applyBenchAndComplete({
      ...parsed.data,
      userId: user.id,
    })
    return NextResponse.json(order, { status: 201 })
  })
}
