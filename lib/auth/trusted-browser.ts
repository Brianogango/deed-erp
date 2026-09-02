import 'server-only'

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { shouldUseSecureCookie } from '@/lib/auth/session-issuer'

const TRUSTED_BROWSER_COOKIE = 'deed-trusted-browser'
const TRUSTED_BROWSER_TTL_SECONDS = 180 * 24 * 60 * 60

function tokenHash(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a)
  const bb = Buffer.from(b)
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
}

function clientIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null
}

function parseCookie(value: string | undefined | null): { id: string; secret: string } | null {
  if (!value) return null
  const [id, secret, extra] = value.split('.')
  if (!id || !secret || extra || !/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{40,}$/.test(secret)) return null
  return { id, secret }
}

/**
 * Return true only when this exact browser has a live server-side trust record
 * for the same user and the same session version. Password changes increment
 * session_version, which invalidates every previously trusted browser without
 * needing to expose or store an MFA code in the browser.
 */
export async function isTrustedBrowserRequest(
  request: NextRequest,
  userId: string,
  sessionVersion: number,
): Promise<boolean> {
  const parsed = parseCookie(request.cookies.get(TRUSTED_BROWSER_COOKIE)?.value)
  if (!parsed) return false

  try {
    const { rows } = await sql`
      SELECT token_hash, expires_at, revoked_at
      FROM user_trusted_browsers
      WHERE id = ${parsed.id}
        AND user_id = ${userId}
        AND session_version = ${sessionVersion}
      LIMIT 1
    `
    if (!rows.length) return false
    const row = rows[0]
    if (row.revoked_at) return false
    if (!row.expires_at || new Date(String(row.expires_at)).getTime() <= Date.now()) return false
    if (!safeEqual(String(row.token_hash || ''), tokenHash(parsed.secret))) return false

    const now = new Date().toISOString()
    const ip = clientIp(request)
    await sql`
      UPDATE user_trusted_browsers
      SET last_used_at = ${now}, last_ip = ${ip}
      WHERE id = ${parsed.id}
    `
    return true
  } catch (error) {
    // Missing migration or transient DB errors must fail closed to MFA.
    console.error('[trusted-browser] validation failed:', error instanceof Error ? error.message : 'unknown_error')
    return false
  }
}

export async function trustCurrentBrowser(
  response: NextResponse,
  request: NextRequest,
  userId: string,
  sessionVersion: number,
): Promise<void> {
  const id = crypto.randomUUID()
  const secret = crypto.randomBytes(32).toString('base64url')
  const hash = tokenHash(secret)
  const now = new Date()
  const expires = new Date(now.getTime() + TRUSTED_BROWSER_TTL_SECONDS * 1000)
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500) || null
  const ip = clientIp(request)

  await sql`
    INSERT INTO user_trusted_browsers (
      id, user_id, token_hash, session_version, user_agent,
      created_at, last_used_at, expires_at, created_ip, last_ip, revoked_at
    ) VALUES (
      ${id}, ${userId}, ${hash}, ${sessionVersion}, ${userAgent},
      ${now.toISOString()}, ${now.toISOString()}, ${expires.toISOString()}, ${ip}, ${ip}, NULL
    )
  `

  // Keep the table tidy without making login depend on a background cleanup job.
  await sql`
    DELETE FROM user_trusted_browsers
    WHERE expires_at < ${now.toISOString()}
       OR (revoked_at IS NOT NULL AND revoked_at < ${new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()})
  `.catch(() => {})

  response.cookies.set(TRUSTED_BROWSER_COOKIE, `${id}.${secret}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: TRUSTED_BROWSER_TTL_SECONDS,
  })
}

export function clearTrustedBrowserCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(TRUSTED_BROWSER_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: 0,
  })
}

export async function revokeAllTrustedBrowsers(userId: string): Promise<void> {
  const now = new Date().toISOString()
  try {
    await sql`
      UPDATE user_trusted_browsers
      SET revoked_at = COALESCE(revoked_at, ${now})
      WHERE user_id = ${userId}
    `
  } catch (error) {
    console.error('[trusted-browser] revoke-all failed:', error instanceof Error ? error.message : 'unknown_error')
  }
}
