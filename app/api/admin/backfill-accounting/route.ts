import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { mirrorAccountsToPrisma, mirrorJournalEntriesToPrisma } from '@/lib/accounting/account-journal-mirror'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'
import { mirrorRepairsToPrisma } from '@/lib/repair-mirror'
import { mirrorDepositsToPrisma } from '@/lib/accounting/deposit-mirror'
import { mirrorHoldoversToPrisma } from '@/lib/accounting/holdover-mirror'
import { bootstrapChartOfAccounts } from '@/lib/accounting/coa-bootstrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Idempotent dual-write backfill. NEVER deletes app_state.
 * Auth: director session, or x-internal-secret (same as backfill-repairs).
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  const secretOk = Boolean(internalSecret && providedSecret === internalSecret)

  if (!secretOk) {
    const session = await getServerSession()
    if (!session || session.user.role !== 'director') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await request.json().catch(() => ({}))
  const force = !!body.force
  const sections: string[] = Array.isArray(body.sections)
    ? body.sections
    : ['coa', 'accounts', 'journals', 'reservations', 'repairs', 'deposits', 'holdovers']

  const state = await loadAppState([
    'deed_accounts',
    'deed_journalEntries',
    'deed_stockReservations',
    'deed_repairs_v2',
    'deed_deposits',
    'deed_deposits_v1',
    'deed_holdovers',
  ])

  const result: Record<string, unknown> = {
    blobCounts: {
      accounts: Array.isArray(state.deed_accounts) ? state.deed_accounts.length : 0,
      journals: Array.isArray(state.deed_journalEntries) ? state.deed_journalEntries.length : 0,
      reservations: Array.isArray(state.deed_stockReservations) ? state.deed_stockReservations.length : 0,
      repairs: Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2.length : 0,
      deposits: Array.isArray(state.deed_deposits)
        ? state.deed_deposits.length
        : (Array.isArray(state.deed_deposits_v1) ? state.deed_deposits_v1.length : 0),
      holdovers: Array.isArray(state.deed_holdovers) ? state.deed_holdovers.length : 0,
    },
    note: 'app_state keys were not deleted',
  }

  if (sections.includes('coa')) {
    result.coa = await bootstrapChartOfAccounts()
  }
  if (sections.includes('accounts')) {
    result.accounts = await mirrorAccountsToPrisma(state.deed_accounts ?? [], { force })
  }
  if (sections.includes('journals')) {
    result.journals = await mirrorJournalEntriesToPrisma(state.deed_journalEntries ?? [], { force })
    result.journalsNote = 'Historical journal backfill mirrors deed_journalEntries blobs; re-run is idempotent on ref.'
  }
  if (sections.includes('reservations')) {
    result.reservations = await mirrorStockReservationsToPrisma(state.deed_stockReservations ?? [], { force })
  }
  if (sections.includes('repairs')) {
    result.repairs = await mirrorRepairsToPrisma(state.deed_repairs_v2 ?? [], { force })
  }
  if (sections.includes('deposits')) {
    result.deposits = await mirrorDepositsToPrisma(state.deed_deposits ?? state.deed_deposits_v1 ?? [], { force })
  }
  if (sections.includes('holdovers')) {
    result.holdovers = await mirrorHoldoversToPrisma(state.deed_holdovers ?? [], { force })
  }

  return NextResponse.json(result)
}
