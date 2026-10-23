import { NextRequest, NextResponse } from 'next/server'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { hasRiderSession, loadRiderData, needPin, noStore, riderForToken } from '@/lib/delivery/rider-portal.server'
import { onRiderLink, riderJobView, riderWeeks } from '@/lib/delivery/rider-portal'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

const ACTIVE = new Set(['assigned', 'in_transit'])

/** GET — the rider's open jobs, recent finished ones and trips by week. */
export const GET = guardPortalRoute('rider-read', 600, async (req: NextRequest, { params }: Params) => {
  const { token } = await params
  const rider = await riderForToken(token)
  if (!rider) return NextResponse.json({ error: 'This link is no longer active. Ask the office for a new one.' }, { status: 404, headers: noStore })
  if (!hasRiderSession(req, rider)) return needPin(rider)

  const { jobs, pays } = await loadRiderData()
  const mine = jobs.filter(j => j.riderId === rider.id && onRiderLink(j as any))
  const since = Date.now() - 14 * 86_400_000
  const open = mine
    .filter(j => ACTIVE.has(j.status))
    .sort((a, b) => String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? '')))
  const recent = mine
    .filter(j => (j.status === 'delivered' || j.status === 'failed') && Date.parse(j.deliveredAt ?? j.scheduledDate ?? '') >= since)
    .sort((a, b) => String(b.deliveredAt ?? b.scheduledDate ?? '').localeCompare(String(a.deliveredAt ?? a.scheduledDate ?? '')))
    .slice(0, 40)

  return NextResponse.json({
    rider: { name: rider.name, vehicle: rider.vehicle ?? '', rate: Number(rider.ratePerDelivery) || 0 },
    open: open.map(riderJobView),
    recent: recent.map(riderJobView),
    weeks: riderWeeks(rider.id, jobs, pays),
  }, { headers: noStore })
})
