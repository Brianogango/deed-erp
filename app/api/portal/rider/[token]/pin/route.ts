import { NextRequest, NextResponse } from 'next/server'
import { guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { noStore, riderForToken } from '@/lib/delivery/rider-portal.server'
import { pinMatches, riderCookieName, riderSession } from '@/lib/delivery/rider-portal'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

/** POST { pin } — unlock this phone for the rider (wrong PINs count toward a lockout). */
export const POST = guardPortalRoute('rider-pin', 60, async (req: NextRequest, { params }: Params) => {
  const { token } = await params
  const rider = await riderForToken(token)
  if (!rider) return NextResponse.json({ error: 'This link is no longer active.' }, { status: 404, headers: noStore })
  const body = await req.json().catch(() => ({})) as { pin?: unknown }
  if (!pinMatches(rider, body.pin)) {
    return NextResponse.json({ error: 'Wrong PIN. It is the last 4 digits of your ID number.' }, { status: 403, headers: noStore })
  }
  const res = NextResponse.json({ ok: true }, { headers: noStore })
  res.cookies.set(riderCookieName(rider.id), riderSession(rider), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  })
  return res
})
