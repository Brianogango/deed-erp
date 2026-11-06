import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { describeOffBooks, fixOldPaidToRider, needsOffBooksFix } from '@/lib/delivery/rider-direct-pay.server'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']

async function toFix() {
  const state = await loadAppState(['deed_deliveryJobs'])
  return (Array.isArray(state.deed_deliveryJobs) ? state.deed_deliveryJobs as Array<Record<string, any>> : []).filter(needsOffBooksFix)
}

/** Trips whose direct rider payment was booked the first way (a payment on the invoice plus delivery expense). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const jobs = await toFix()
    return NextResponse.json({ jobs: jobs.map(j => ({ id: j.id, ref: j.ref, amount: Number(j.customerPaidRider?.amount) || 0, invoiceRef: j.customerPaidRider?.invoiceRef })) })
  })
}

/**
 * Fix them all: reverse each "paid to rider" payment (which also reverses its
 * delivery-expense entry) and take the charge off the invoice by credit note.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const who = { id: String((actor as any).id), name: String((actor as any).name || (actor as any).username || 'Finance') }
    const results: Array<{ ref: string; ok: boolean; message: string }> = []
    for (const job of await toFix()) {
      try {
        const r = await fixOldPaidToRider(String(job.id), who)
        results.push(r.ok
          ? { ref: job.ref, ok: true, message: `${r.reversed > 0 ? `payment of KES ${r.reversed.toLocaleString('en-KE')} reversed · ` : ''}${describeOffBooks(r.offBooks)}` }
          : { ref: job.ref, ok: false, message: r.error })
      } catch (err) {
        results.push({ ref: job.ref, ok: false, message: err instanceof Error ? err.message : 'Could not fix this one' })
      }
    }
    return NextResponse.json({ results })
  })
}
