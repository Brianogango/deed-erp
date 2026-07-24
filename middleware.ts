import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

// No hardcoded fallback: a guessable default secret would let anyone forge a
// valid session token for any role. If neither env var is set, auth checks
// below fail closed (deny) instead of trusting a known string.
const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const COOKIE_NAME = 'deed-session'

// Paths that never require a session
const PUBLIC_PAGES        = new Set(['/login'])
// /api/setup-admin has no session to check against on a fresh DB — it enforces
// its own SETUP_ADMIN_SECRET header check and refuses to run once users exist.
const PUBLIC_API_PATHS    = new Set(['/api/auth/login', '/api/auth/logout', '/api/setup-admin'])
const PUBLIC_ASSET_PATHS  = new Set(['/deed-logo.png', '/deed-logo.svg'])
const PUBLIC_PATH_PREFIXES = ['/track', '/portal', '/api/portal/repair', '/api/portal/quotes', '/api/portal/intake']
const HIGH_TRAFFIC_READ_PREFIXES = ['/api/store/stream']

export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  '/dashboard': '/',
  '/purchase': '/purchases',
  '/inventory': '/operations',
  '/accounting': '/finance',
  '/after_sales': '/aftersales',
  '/hr/documents': '/documents',
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function redirectTo(path: string, req: NextRequest): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = path
  return NextResponse.redirect(url)
}

function isWriteMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function rateLimitPolicy(pathname: string, method: string): { limit: number; windowSec: number; bucket: string } {
  if (pathname === '/api/auth/login') return { limit: 10, windowSec: 60, bucket: 'login' }
  if (pathname === '/api/admin/reset') return { limit: 3, windowSec: 60 * 60, bucket: 'critical-admin' }
  if (pathname.startsWith('/api/jarvis/chat')) return { limit: 20, windowSec: 60, bucket: 'jarvis-chat' }
  if (pathname.startsWith('/api/jarvis/ingest')) return { limit: 5, windowSec: 60 * 60, bucket: 'jarvis-ingest' }
  if (pathname === '/api/store' && isWriteMethod(method)) return { limit: 20, windowSec: 60, bucket: 'store-migration' }
  if (HIGH_TRAFFIC_READ_PREFIXES.some(prefix => pathname.startsWith(prefix))) return { limit: 120, windowSec: 60, bucket: 'store-stream' }
  if (isWriteMethod(method)) return { limit: 240, windowSec: 60, bucket: 'api-write' }
  return { limit: 1200, windowSec: 60, bucket: 'api-read' }
}

function withRateLimitHeaders(response: NextResponse, remaining: number, resetAt: number): NextResponse {
  response.headers.set('X-RateLimit-Remaining', String(remaining))
  response.headers.set('X-RateLimit-Reset', String(resetAt))
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public static assets and public portal / track paths
  if (PUBLIC_ASSET_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Login is public, but it must still be rate-limited to protect credentials.
  if (pathname === '/api/auth/login') {
    const ip = getIP(request)
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const policy = rateLimitPolicy(pathname, request.method)
    const { success, remaining, resetAt } = await checkRateLimit(`login:${ip}`, policy.limit, policy.windowSec)
    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        },
      })
    }
    return withRateLimitHeaders(NextResponse.next(), remaining, resetAt)
  }

  // Other public auth/setup endpoints pass through.
  if (PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // Partner-facing public API (/api/public/*): no session cookie — the routes
  // authenticate with a partner API key themselves. Still rate-limited here,
  // per presented key (falling back to caller IP when no key is sent).
  if (pathname.startsWith('/api/public/')) {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const presentedKey = request.headers.get('x-api-key') ?? request.headers.get('authorization') ?? ''
    const limiterId = presentedKey ? presentedKey.slice(-24) : getIP(request)
    const { success, remaining, resetAt } = await checkRateLimit(`partner-api:${limiterId}`, 120, 60)
    if (!success) {
      return new NextResponse(JSON.stringify({ error: 'Rate limit exceeded — max 120 requests per minute' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        },
      })
    }
    return withRateLimitHeaders(NextResponse.next(), remaining, resetAt)
  }

  // NextAuth internal routes — always pass through
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // ── API auth and rate limiting ─────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (!SECRET) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Server-side maintenance calls authenticate with the internal secret;
    // the target route re-validates the same header before doing anything.
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (
      pathname === '/api/admin/backfill-repairs' &&
      internalSecret &&
      request.headers.get('x-internal-secret') === internalSecret
    ) {
      return NextResponse.next()
    }

    const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { checkRateLimit } = await import('@/lib/rate-limit')
    const ip = getIP(request)
    const policy = rateLimitPolicy(pathname, request.method)
    const userKey = typeof token.id === 'string' ? token.id : (typeof token.sub === 'string' ? token.sub : ip)
    const key = `${policy.bucket}:${userKey}:${request.method}:${pathname}`
    const { success, remaining, resetAt } = await checkRateLimit(key, policy.limit, policy.windowSec)

    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        },
      })
    }

    return withRateLimitHeaders(NextResponse.next(), remaining, resetAt)
  }

  // ── Page auth ─────────────────────────────────────────────────────────────
  const token = SECRET ? await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME }) : null

  if (!token && !PUBLIC_PAGES.has(pathname)) {
    return redirectTo('/login', request)
  }
  if (token && pathname === '/login') {
    return redirectTo('/', request)
  }

  const canonicalPath = LEGACY_ROUTE_REDIRECTS[pathname]
  if (token && canonicalPath) {
    return redirectTo(canonicalPath, request)
  }

  if (token && pathname === '/hr' && request.nextUrl.searchParams.get('tab') === 'system_users') {
    const url = request.nextUrl.clone()
    url.pathname = '/settings'
    url.search = '?tab=users'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest|deed-logo.png|deed-logo.svg).*)'],
}
