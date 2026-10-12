import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { CreditFacilityError } from './credit-facility.server'

/**
 * The visitor's address. Nginx appends the real address to the END of
 * X-Forwarded-For; anything before it was sent by the visitor and can be
 * made up (taking the first entry let anyone dodge the limits by sending a
 * new fake address with every request).
 */
export function clientIp(req: Pick<NextRequest, 'headers'>): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean)
  return forwarded?.length ? forwarded[forwarded.length - 1] : req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Wrong links allowed from one address before it is shut out for an hour. */
export const BAD_LINK_LIMIT = 10
const BAD_LINK_WINDOW_MS = 60 * 60 * 1000
const badLinks = new Map<string, { count: number; firstAt: number; blockedUntil: number }>()

function blockedUntil(ip: string, now = Date.now()): number {
  const entry = badLinks.get(ip)
  if (!entry) return 0
  if (entry.blockedUntil > now) return entry.blockedUntil
  if (now - entry.firstAt > BAD_LINK_WINDOW_MS) badLinks.delete(ip)
  return 0
}

function recordBadLink(ip: string, now = Date.now()) {
  if (badLinks.size > 10_000) {
    for (const [k, e] of badLinks) if (e.blockedUntil < now && now - e.firstAt > BAD_LINK_WINDOW_MS) badLinks.delete(k)
  }
  const entry = badLinks.get(ip)
  const fresh = !entry || now - entry.firstAt > BAD_LINK_WINDOW_MS
  const next = fresh ? { count: 1, firstAt: now, blockedUntil: 0 } : { ...entry!, count: entry!.count + 1 }
  if (next.count >= BAD_LINK_LIMIT) {
    next.blockedUntil = now + BAD_LINK_WINDOW_MS
    console.warn(`[portal-credit] ${ip} blocked for an hour after ${next.count} wrong credit-application links`)
  }
  badLinks.set(ip, next)
}

/** For tests. */
export function resetBadLinks() { badLinks.clear() }

const tooMany = (resetAt: number) => NextResponse.json(
  { error: 'Too many requests. Please wait a while and try again.' },
  { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))), 'Cache-Control': 'no-store' } },
)

/**
 * Public credit-link endpoints. Limits per address and per link (so one
 * link cannot be hammered from many addresses), an address that keeps
 * trying wrong links is shut out for an hour, errors as plain messages.
 */
export async function portalHandler(req: NextRequest, bucket: string, limit: number, fn: () => Promise<Response>, token?: string): Promise<Response> {
  const ip = clientIp(req)
  const until = blockedUntil(ip)
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
      if (err.status === 404) recordBadLink(ip)
      return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[portal-credit]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
