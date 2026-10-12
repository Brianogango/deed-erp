import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * Shared protection for every client-facing endpoint (repair portal, quotes,
 * intake form, credit link): per-address limits that cannot be dodged with a
 * made-up address, and a one-hour lockout for an address that keeps hitting
 * wrong references or wrong phone numbers (guessing).
 */

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

/** Wrong references / phone numbers allowed from one address in an hour. */
export const FAILURE_LIMIT = 10
/** Wrong phone numbers allowed against one repair or quote in an hour (from any address). */
export const RECORD_FAILURE_LIMIT = 25
const WINDOW_MS = 60 * 60 * 1000

type Entry = { count: number; firstAt: number; blockedUntil: number }
const failures = new Map<string, Entry>()

export function blockedUntil(key: string, now = Date.now()): number {
  const entry = failures.get(key)
  if (!entry) return 0
  if (entry.blockedUntil > now) return entry.blockedUntil
  if (now - entry.firstAt > WINDOW_MS) failures.delete(key)
  return 0
}

export function recordFailure(key: string, limit: number, now = Date.now()) {
  if (failures.size > 20_000) {
    for (const [k, e] of failures) if (e.blockedUntil < now && now - e.firstAt > WINDOW_MS) failures.delete(k)
  }
  const entry = failures.get(key)
  const fresh = !entry || now - entry.firstAt > WINDOW_MS
  const next = fresh ? { count: 1, firstAt: now, blockedUntil: 0 } : { ...entry!, count: entry!.count + 1 }
  if (next.count >= limit && !next.blockedUntil) {
    next.blockedUntil = now + WINDOW_MS
    console.warn(`[portal-guard] ${key} blocked for an hour after ${next.count} failed attempts`)
  }
  failures.set(key, next)
}

/** For tests. */
export function resetPortalFailures() { failures.clear() }

export const tooManyRequests = (resetAt: number) => NextResponse.json(
  { error: 'Too many requests. Please wait a while and try again.' },
  { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))), 'Cache-Control': 'no-store' } },
)

/** "repair/REP-2026-0001" or "quotes/<id>" from /api/portal/<kind>/<id>/… */
function recordKey(req: NextRequest): string | null {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  return parts[0] === 'api' && parts[1] === 'portal' && parts[3] ? `${parts[2]}/${decodeURIComponent(parts[3]).toUpperCase()}` : null
}

/** A phone number was tried: a POST (approve / pay) or a document opened with ?phone=. */
const triesPhone = (req: NextRequest) => req.method !== 'GET' || new URL(req.url).searchParams.has('phone')

/**
 * Wraps a client-facing route handler. `limit` is requests per address per
 * hour for this kind of request. A 404 (no such repair / quote) or a 403
 * after a phone was tried counts as a failed guess.
 */
export function guardPortalRoute<C>(bucket: string, limit: number, handler: (req: NextRequest, ctx: C) => Promise<Response> | Response) {
  return async (req: NextRequest, ctx?: C): Promise<Response> => {
    const ip = clientIp(req)
    const record = recordKey(req)
    const phoneTry = triesPhone(req)
    const until = Math.max(blockedUntil(`ip:${ip}`), phoneTry && record ? blockedUntil(`record:${record}`) : 0)
    if (until) return tooManyRequests(until)
    const rl = await checkRateLimit(`portal-${bucket}:${ip}`, limit, 3600)
    if (!rl.success) return tooManyRequests(rl.resetAt)
    const res = await handler(req, ctx as C)
    if (res.status === 404) recordFailure(`ip:${ip}`, FAILURE_LIMIT)
    else if (res.status === 403 && phoneTry) {
      recordFailure(`ip:${ip}`, FAILURE_LIMIT)
      if (record) recordFailure(`record:${record}`, RECORD_FAILURE_LIMIT)
    }
    return res
  }
}

/**
 * Text as typed, minus anything that is not ordinary text: control
 * characters (line breaks kept when `multiline`) and angle brackets, so a
 * value can never carry HTML into an email, PDF or screen. Capped in length.
 */
export function cleanPortalText(value: unknown, max: number, multiline = false): string {
  if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return ''
  return String(value)
    .normalize('NFKC')
    .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max)
}
