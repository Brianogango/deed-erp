import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Use the shared role check so aliases (e.g. "finance") resolve correctly.
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState()
  const runs: any[] = Array.isArray(state['deed_payrollRuns']) ? state['deed_payrollRuns'] as any[] : []
  const idx = runs.findIndex(r => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const before = runs[idx]

  // Enforce a payroll status state machine and never trust client-supplied
  // monetary totals on update. Only the status may advance, and only forward:
  //   draft → pending_approval → approved → posted
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    draft: ['pending_approval'],
    pending_approval: ['approved'],
    approved: ['posted'],
    posted: [],
  }
  const nextStatus = body.status
  if (nextStatus !== undefined && nextStatus !== before?.status) {
    const allowed = ALLOWED_TRANSITIONS[before?.status ?? 'pending_approval'] ?? []
    if (!allowed.includes(nextStatus)) {
      return NextResponse.json(
        { error: `Illegal payroll status change: ${before?.status ?? 'unknown'} → ${nextStatus}` },
        { status: 409 },
      )
    }
  }

  // Whitelist mutable fields — totals/lines are computed at run creation and
  // must not be rewritten through this endpoint.
  const patch: Record<string, unknown> = {}
  if (nextStatus !== undefined) patch.status = nextStatus
  if (typeof body.postedJournalId === 'string') patch.postedJournalId = body.postedJournalId

  runs[idx] = { ...before, ...patch, id: params.id }
  await saveStoreKeys({ deed_payrollRuns: JSON.stringify(runs) })

  await writeFinancialAudit({
    userId: session.user.id,
    action: 'update_payroll_run',
    entityType: 'payroll_run',
    oldValues: { status: before?.status, netPay: before?.netPay ?? before?.totalNet },
    newValues: { status: runs[idx]?.status, netPay: runs[idx]?.netPay ?? runs[idx]?.totalNet },
  })

  return NextResponse.json({ item: runs[idx] })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}
