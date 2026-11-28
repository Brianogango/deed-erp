import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { syncWarranties } from '@/lib/warranty/e-warranty.server'

export const dynamic = 'force-dynamic'

/** Issue the warranties still missing for serial-numbered machines sold (deliveries, POS, Kilimall). */
export async function POST() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const out = await syncWarranties()
    // Machines upgraded on the bench and then sold: their documents and
    // warranties take the new specs (and, once, every such machine sold before).
    void import('@/lib/reconfiguration/sales-bridge')
      .then(m => m.refreshReconfiguredSales(out.added.map(w => w.serialId)))
      .catch(() => {})
    return NextResponse.json(out)
  })
}
