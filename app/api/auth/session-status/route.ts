import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { encode, getToken } from 'next-auth/jwt'
import { getServerSession } from '@/lib/auth/server'
import {
  SESSION_TTL_SECONDS,
  SESSION_ABSOLUTE_MAX_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
  SESSION_WARN_BEFORE_SECONDS,
} from '@/lib/auth/session-policy'
import { sql } from '@/lib/auth/db'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const COOKIE_NAME = 'deed-session'

function shouldUseSecureCookie(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return (
    forwardedProto === 'https' ||
    request.nextUrl.protocol === 'https:' ||
    process.env.NEXTAUTH_URL?.startsWith('https://') ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
    false
  )
}

function computeExpiry(token: Record<string, unknown>): {
  issuedAtMs: number
  expiresAtMs: number
  absoluteDeadlineMs: number
  canRefresh: boolean
} {
  const now = Date.now()
  const issuedAtRaw = typeof token.sessionIssuedAt === 'string' ? Date.parse(token.sessionIssuedAt) : NaN
  const issuedAtMs = Number.isFinite(issuedAtRaw) ? issuedAtRaw : now - SESSION_TTL_SECONDS * 1000
  const absoluteDeadlineMs = issuedAtMs + SESSION_ABSOLUTE_MAX_SECONDS * 1000
  const expRaw = typeof token.exp === 'number' ? token.exp * 1000 : NaN
  const expiresAtMs = Number.isFinite(expRaw) ? expRaw : now + SESSION_TTL_SECONDS * 1000
  const canRefresh = now < absoluteDeadlineMs && expiresAtMs - now < SESSION_REFRESH_THRESHOLD_SECONDS * 1000
  return { issuedAtMs, expiresAtMs, absoluteDeadlineMs, canRefresh }
}

/** GET — current session expiry for the countdown UI. */
export async function GET(request: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { issuedAtMs, expiresAtMs, absoluteDeadlineMs, canRefresh } = computeExpiry(token as Record<string, unknown>)
  return NextResponse.json({
    ok: true,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    absoluteDeadline: new Date(absoluteDeadlineMs).toISOString(),
    canRefresh,
    warnBeforeSeconds: SESSION_WARN_BEFORE_SECONDS,
    ttlSeconds: SESSION_TTL_SECONDS,
  })
}

/** POST — sliding refresh within the absolute lifetime cap (P0-DEED-001). */
export async function POST(request: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { issuedAtMs, absoluteDeadlineMs } = computeExpiry(token as Record<string, unknown>)
  const now = Date.now()
  if (now >= absoluteDeadlineMs) {
    return NextResponse.json(
      { error: 'Session absolute lifetime exceeded — please sign in again', code: 'absolute_cap' },
      { status: 401 },
    )
  }

  const sessionIssuedAt =
    typeof token.sessionIssuedAt === 'string'
      ? token.sessionIssuedAt
      : new Date(issuedAtMs).toISOString()

  const remainingAbsolute = Math.max(1, Math.floor((absoluteDeadlineMs - now) / 1000))
  const maxAge = Math.min(SESSION_TTL_SECONDS, remainingAbsolute)

  const jwt = await encode({
    token: {
      sub: session.user.id,
      id: session.user.id,
      name: session.user.name,
      username: session.user.username,
      role: session.user.role,
      modules: session.user.modules,
      active: session.user.active,
      createdAt: session.user.createdAt,
      actsAsTechnician: Boolean(token.actsAsTechnician ?? session.user.actsAsTechnician),
      mfaVerified: token.mfaVerified === true,
      sessionVersion: Math.max(1, Number(token.sessionVersion ?? 1) || 1),
      sessionIssuedAt,
    },
    secret: SECRET,
    maxAge,
  })

  const expiresAt = new Date(now + maxAge * 1000).toISOString()
  const response = NextResponse.json({
    ok: true,
    expiresAt,
    absoluteDeadline: new Date(absoluteDeadlineMs).toISOString(),
    canRefresh: maxAge < remainingAbsolute && remainingAbsolute - maxAge > 0,
  })
  response.cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge,
  })

  try {
    const oldJwt = request.cookies.get(COOKIE_NAME)?.value || ''
    const oldHash = oldJwt ? crypto.createHash('sha256').update(oldJwt).digest('hex') : ''
    const newHash = crypto.createHash('sha256').update(jwt).digest('hex')
    const expiresAtDate = new Date(expiresAt)
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || null
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null

    let updatedRows: Record<string, unknown>[] = []
    if (oldHash) {
      const updated = await sql`
        UPDATE user_sessions
        SET token_hash = ${newHash},
            ip_address = ${ipAddress},
            user_agent = ${userAgent},
            expires_at = ${expiresAtDate}
        WHERE token_hash = ${oldHash}
        RETURNING id
      `
      updatedRows = updated.rows
    }

    if (updatedRows.length === 0) {
      await sql`
        INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at)
        VALUES (${session.user.id}, ${newHash}, ${ipAddress}, ${userAgent}, ${expiresAtDate}, NOW())
        ON CONFLICT (token_hash) DO UPDATE SET
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          expires_at = EXCLUDED.expires_at
      `
    }
  } catch {
    // Session indexing supports administrative visibility only. The refreshed
    // JWT cookie remains authoritative if the optional index write fails.
  }

  return response
}
