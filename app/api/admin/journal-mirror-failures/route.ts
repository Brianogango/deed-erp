import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { mirrorJournalEntriesToPrisma } from '@/lib/accounting/account-journal-mirror'
import {
  dismissJournalMirrorFailure,
  loadJournalMirrorFailures,
  saveJournalMirrorFailures,
  sortJournalMirrorFailures,
} from '@/lib/accounting/journal-mirror-failures'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Journals that were posted into the blob but refused by the Prisma mirror.
 *
 * Those journals are absent from the Trial Balance, the P&L and the Balance
 * Sheet, which all read journal_entries. GET lists them with the reason each
 * was refused; POST re-runs the mirror over the current blob, which retries
 * every one of them (a refused ref carries no fingerprint, so it is never
 * skipped) and reports what is left.
 *
 * Auth matches backfill-accounting: a director session, or the internal secret.
 */
async function authorize(request: NextRequest): Promise<boolean> {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return true
  const session = await getServerSession()
  return Boolean(session && session.user.role === 'director')
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const failures = sortJournalMirrorFailures(await loadJournalMirrorFailures())
  return NextResponse.json(
    { count: failures.length, failures },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  // Dismissal: for refusals that retrying can never fix. An aborted POS ticket
  // carries no lines and a zero amount, and the validator requires at least
  // two lines — so it had failed 38 times and would have failed at every
  // month-end from now on, blocking the close over a sale that never happened.
  // The entry is kept, with who dismissed it and why; it simply stops being
  // counted. A later successful mirror clears it outright as before.
  if (Array.isArray(body.dismiss) && body.dismiss.length > 0) {
    const reason = String(body.reason || '').trim()
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to dismiss a journal that will never post' },
        { status: 422 },
      )
    }
    const session = await getServerSession()
    const actor = session?.user?.id ?? null
    let map = await loadJournalMirrorFailures()
    const dismissed: string[] = []
    const unknown: string[] = []
    for (const raw of body.dismiss.slice(0, 100)) {
      const ref = String(raw)
      if (!(ref in map)) { unknown.push(ref); continue }
      map = dismissJournalMirrorFailure(map, ref, actor, reason)
      dismissed.push(ref)
    }
    if (dismissed.length > 0) await saveJournalMirrorFailures(map)
    const remaining = sortJournalMirrorFailures(map).filter(f => !f.dismissedAt)
    return NextResponse.json({ dismissed, unknown, remaining: remaining.length })
  }

  const before = sortJournalMirrorFailures(await loadJournalMirrorFailures()).filter(f => !f.dismissedAt)

  const state = await loadAppState(['deed_journalEntries'])
  const raw = state['deed_journalEntries']
  const entries = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'No journal entries in app_state' }, { status: 404 })
  }

  // force re-fingerprints every entry; the default retries only what is
  // outstanding, which is what a routine "clear the backlog" wants.
  const result = await mirrorJournalEntriesToPrisma(entries, { force: !!body.force })
  const after = sortJournalMirrorFailures(await loadJournalMirrorFailures()).filter(f => !f.dismissedAt)

  return NextResponse.json({
    ...result,
    resolved: before.length - after.length,
    remaining: after.length,
    failures: after,
  })
}
