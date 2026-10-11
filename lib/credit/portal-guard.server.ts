import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { CreditFacilityError } from './credit-facility.server'

const clientIp = (req: NextRequest) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown'

/** Public credit-link endpoints: rate limited per IP, errors as plain messages. */
export async function portalHandler(req: NextRequest, bucket: string, limit: number, fn: () => Promise<Response>): Promise<Response> {
  const rl = await checkRateLimit(`portal-credit-${bucket}:${clientIp(req)}`, limit, 3600)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Please wait a while and try again.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }
  try {
    return await fn()
  } catch (err) {
    if (err instanceof CreditFacilityError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[portal-credit]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
