import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { syncWarranties } from '@/lib/warranty/e-warranty.server'

export const dynamic = 'force-dynamic'

/** Issue the warranties still missing for serial-numbered machines sold (deliveries, POS, Kilimall). */
export async function POST() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    return NextResponse.json(await syncWarranties())
  })
}
