import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readStoreCopies } from '@/lib/server-store'
import { stockTableParity } from '@/lib/stock-read-model.server'

export const dynamic = 'force-dynamic'

/** Read-only: do serial_numbers / stock_location_levels match the deed_serials / deed_bulkStock copies? */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'inventory_officer'])
    const copies = await readStoreCopies(['deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
    return NextResponse.json(await stockTableParity(copies.deed_serials, copies.deed_bulkStock, copies.deed_stockMoves))
  })
}
