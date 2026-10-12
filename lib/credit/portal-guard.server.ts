import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { FAILURE_LIMIT, blockedUntil, clientIp, recordFailure, resetPortalFailures, tooManyRequests } from '@/lib/portal/portal-guard.server'
import { CreditFacilityError } from './credit-facility.server'

export { clientIp }

/** Wrong links allowed from one address before it is shut out for an hour. */
export const BAD_LINK_LIMIT = FAILURE_LIMIT

/** For tests. */
export const resetBadLinks = resetPortalFailures

const tooMany = tooManyRequests

/**
 * Public credit-link endpoints. Limits per address and per link (so one
 * link cannot be hammered from many addresses), an address that keeps
 * trying wrong links is shut out for an hour, errors as plain messages.
 */
export async function portalHandler(req: NextRequest, bucket: string, limit: number, fn: () => Promise<Response>, token?: string): Promise<Response> {
  const ip = clientIp(req)
  const until = blockedUntil(`ip:${ip}`)
  if (until) return tooMany(until)
  const rl = await checkRateLimit(`portal-credit-${bucket}:${ip}`, limit, 3600)
  if (!rl.success) return tooMany(rl.resetAt)
  if (token) {
    const perLink = await checkRateLimit(`portal-credit-${bucket}-link:${token.slice(0, 40)}`, limit * 2, 3600)
    if (!perLink.success) return tooMany(perLink.resetAt)
  }
  try {
    return await fn()
  } catch (err) {
    if (err instanceof CreditFacilityError) {
      if (err.status === 404) recordFailure(`ip:${ip}`, FAILURE_LIMIT)
      return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[portal-credit]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
