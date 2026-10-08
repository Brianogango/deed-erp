import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readStoreCopies } from '@/lib/server-store'
import { stockTableParity } from '@/lib/stock-read-model.server'

export const dynamic = 'force-dynamic'

/** The migration that adds what a "column/table does not exist" error is missing. */
function missingMigration(message: string): string | null {
  if (/removed_at|stock_location_levels/i.test(message)) return 'database/migrations/20261009_stock_locations_safe.sql'
  if (/receipt_documents/i.test(message)) return 'database/migrations/20261009_receipt_documents_safe.sql'
  if (/stock_movements.*screen_extras|screen_extras.*stock_movements/i.test(message)) return 'database/migrations/20261009_stock_moves_table_safe.sql'
  if (/serial_numbers|location|screen_extras/i.test(message)) return 'database/migrations/20261009_serial_location_safe.sql'
  return null
}

/** Read-only: do the stock tables match the deed_serials / deed_bulkStock / deed_stockMoves / deed_receipts copies? */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'inventory_officer'])
    try {
      const copies = await readStoreCopies(['deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts'])
      return NextResponse.json(await stockTableParity(copies.deed_serials, copies.deed_bulkStock, copies.deed_stockMoves, copies.deed_receipts))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const migration = /does not exist|P2021|P2022/i.test(message) ? missingMigration(message) : null
      return NextResponse.json(
        migration
          ? { error: 'A database migration has not been run yet', run: migration }
          : { error: 'The check failed', detail: message.slice(0, 300) },
        { status: migration ? 503 : 500 },
      )
    }
  })
}
