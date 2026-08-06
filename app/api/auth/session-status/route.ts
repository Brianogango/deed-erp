import { NextRequest, NextResponse } from 'next/server'
import { encode, getToken } from 'next-auth/jwt'
import { getServerSession } from '@/lib/auth/server'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const COOKIE_NAME = 'deed-session'
export const SESSION_TTL_SECONDS = 12 * 60 * 60
export const SESSION_ABSOLUTE_MAX_SECONDS = 24 * 60 * 60
export const SESSION_REFRESH_THRESHOLD_SECONDS = 2 * 60 * 60
export const SESSION_WARN_BEFORE_SECONDS = 5 * 60

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
  return response
}
