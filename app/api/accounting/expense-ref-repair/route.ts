import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiErrorHandling } from '@/lib/auth/api'
import { getServerSession } from '@/lib/auth/server'
import {
  expenseRefPlan,
  postMissingExpenseJournals,
  renumberDuplicateClaims,
} from '@/lib/accounting/expense-ref-repair.server'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/accounting/expense-ref-repair — claims sharing an EXP number, and missing journals
 * POST /api/accounting/expense-ref-repair — { step: 'numbers' } or { step: 'journals', since, entryDate }
 *
 * Director, or the internal secret for scripts/repair-expense-numbers.mjs
 * (same pattern as orphaned-invoice-journals: no session cookie in a terminal).
 * Renumbering changes no money. Posting is a separate step with its date
 * basis and start date stated by the caller, and the fiscal lock still
 * refuses closed periods.
 */
const PostSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('numbers') }).strict(),
  z.object({
    step: z.literal('journals'),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entryDate: z.enum(['claim_date', 'today']),
  }).strict(),
])

async function authorize(request: NextRequest): Promise<{ ok: boolean; actorId: string | null }> {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return { ok: true, actorId: null }
  const session = await getServerSession()
  if (session?.user && String(session.user.role) === 'director') return { ok: true, actorId: session.user.id }
  return { ok: false, actorId: null }
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!(await authorize(request)).ok) return NextResponse.json({ error: 'Directors only' }, { status: 403 })
    return NextResponse.json({ plans: await expenseRefPlan() })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const auth = await authorize(request)
    if (!auth.ok) return NextResponse.json({ error: 'Directors only' }, { status: 403 })
    const parsed = PostSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
    if (parsed.data.step === 'numbers') {
      return NextResponse.json({ renumbered: await renumberDuplicateClaims() })
    }
    return NextResponse.json({
      posted: await postMissingExpenseJournals({
        since: parsed.data.since,
        entryDate: parsed.data.entryDate,
        actorId: auth.actorId,
      }),
    })
  })
}
