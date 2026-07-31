import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { mirrorAccountsToPrisma, mirrorJournalEntriesToPrisma } from '@/lib/accounting/account-journal-mirror'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'
import { mirrorRepairsToPrisma } from '@/lib/repair-mirror'

/**
 * Idempotent dual-write backfill. NEVER deletes app_state.
 * POST /api/admin/backfill-accounting
 * body: { force?: boolean, sections?: Array<'accounts'|'journals'|'reservations'|'repairs'> }
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(['director'])
    const body = await request.json().catch(() => ({}))
    const force = !!body.force
    const sections: string[] = Array.isArray(body.sections)
      ? body.sections
      : ['accounts', 'journals', 'reservations', 'repairs']

    const state = await loadAppState([
      'deed_accounts',
      'deed_journalEntries',
      'deed_stockReservations',
      'deed_repairs_v2',
    ])

    const result: Record<string, unknown> = {
      blobCounts: {
        accounts: Array.isArray(state.deed_accounts) ? state.deed_accounts.length : 0,
        journals: Array.isArray(state.deed_journalEntries) ? state.deed_journalEntries.length : 0,
        reservations: Array.isArray(state.deed_stockReservations) ? state.deed_stockReservations.length : 0,
        repairs: Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2.length : 0,
      },
      note: 'app_state keys were not deleted',
    }

    if (sections.includes('accounts')) {
      result.accounts = await mirrorAccountsToPrisma(state.deed_accounts ?? [], { force })
    }
    if (sections.includes('journals')) {
      result.journals = await mirrorJournalEntriesToPrisma(state.deed_journalEntries ?? [], { force })
    }
    if (sections.includes('reservations')) {
      result.reservations = await mirrorStockReservationsToPrisma(state.deed_stockReservations ?? [], { force })
    }
    if (sections.includes('repairs')) {
      result.repairs = await mirrorRepairsToPrisma(state.deed_repairs_v2 ?? [], { force })
    }

    return NextResponse.json(result)
  })
}
