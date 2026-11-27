import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { userCan } from '@/lib/auth/can'
import { findAuthUserById } from '@/lib/auth/users-repository'
import {
  assignUnitTests,
  briefs,
  cancelUnitTest,
  loadTestSettings,
  loadUnitTests,
  markUnitTestsPlaced,
  overrideUnitTest,
  reopenUnitTest,
  saveUnitTest,
  startUnitTest,
  unassignUnitTest,
} from '@/lib/inventory/unit-tests.server'
import { testsForSerial, type UnitTest } from '@/lib/inventory/unit-tests'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

/**
 * Test bench records.
 *
 * GET                → one brief line per unit (its newest test) + settings
 * GET ?serialId=…    → that unit's full test history, newest first
 * POST { action }    → start | save | complete | reopen | cancel | override
 *
 * Any signed-in staff member can read a report (the label's QR code opens
 * it); recording, and passing a failed unit anyway, need their permissions.
 */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const serialId = req.nextUrl.searchParams.get('serialId')?.trim()
    const [tests, settings] = await Promise.all([loadUnitTests(), loadTestSettings()])
    if (serialId) return NextResponse.json({ tests: testsForSerial(tests, serialId), settings })
    return NextResponse.json({ briefs: briefs(tests), settings })
  })
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const body = await req.json().catch(() => ({})) as {
      action?: string; serialId?: string; testId?: string; patch?: Partial<UnitTest>; reason?: string
    }
    const action = String(body.action ?? '')
    const testId = String(body.testId ?? '').trim()
    const reason = String(body.reason ?? '').trim()

    if (action === 'override') {
      const user = await requirePermission('inventory.unit_tests.override')
      const r = await overrideUnitTest(testId, reason, { id: user.id, name: user.name })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      await writeFinancialAudit({
        action: 'unit_test_override',
        entityType: 'serial',
        entityId: r.value.serialId,
        userId: user.id,
        newValues: { testId, serial: r.value.serialNumber, failReasons: r.value.failReasons },
        approvalReason: reason,
      }).catch(() => {})
      return NextResponse.json({ test: r.value })
    }

    // The Technical lead gives units to testers.
    if (action === 'assign' || action === 'unassign') {
      const lead = await requirePermission('inventory.unit_tests.assign')
      const ids = Array.isArray((body as { serialIds?: unknown }).serialIds) ? ((body as { serialIds: unknown[] }).serialIds).map(String).filter(Boolean).slice(0, 200) : []
      if (action === 'unassign') {
        const r = await unassignUnitTest(ids[0] ?? '')
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
        return NextResponse.json({ ok: true })
      }
      const techId = String((body as { techId?: unknown }).techId ?? '').trim()
      const found = techId ? await findAuthUserById(techId).catch(() => null) : null
      const tech = found && found.active !== false ? { id: found.id, name: found.name } : null
      if (!tech) return NextResponse.json({ error: 'Pick an active tester.' }, { status: 422 })
      const r = await assignUnitTests(ids, { id: tech.id, name: tech.name }, { id: lead.id, name: lead.name })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json(r.value)
    }

    const user = await requirePermission('inventory.unit_tests.record')
    const actor = { id: user.id, name: user.name }
    const canAssign = userCan(user, 'inventory.unit_tests.assign')
    // A unit sent from Inbound straight to Refurbishment (the job moves it,
    // not a transfer): its test is used up there.
    if (action === 'sent_to_refurbishment') {
      const ids = Array.isArray((body as { serialIds?: unknown }).serialIds) ? ((body as { serialIds: unknown[] }).serialIds).map(String).filter(Boolean) : []
      await markUnitTestsPlaced('pending_testing', 'repair_unit', ids, actor)
      return NextResponse.json({ ok: true })
    }
    const r = action === 'start' ? await startUnitTest(String(body.serialId ?? '').trim(), actor, { canAssign })
      : action === 'save' ? await saveUnitTest(testId, body.patch ?? {}, { canAssign }, actor)
      : action === 'complete' ? await saveUnitTest(testId, body.patch ?? {}, { complete: true, canAssign }, actor)
      : action === 'reopen' ? await reopenUnitTest(testId)
      : action === 'cancel' ? await cancelUnitTest(testId, reason)
      : null
    if (!r) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ test: r.value })
  })
}
