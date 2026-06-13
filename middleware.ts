import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'deed-erp-demo-secret-2026'
const COOKIE_NAME = 'deed-session'

// Paths that never require a session
const PUBLIC_PAGES        = new Set(['/login'])
const PUBLIC_API_PATHS    = new Set(['/api/auth/login', '/api/auth/logout', '/api/setup-admin'])
const PUBLIC_ASSET_PATHS  = new Set([
  '/deed-logo.png',
  '/deed-logo.svg',
  '/sw.js',
  '/service-worker.js',
  '/offline.html',
])
const PUBLIC_PATH_PREFIXES = ['/track', '/portal', '/api/portal/repair', '/api/portal/quotes', '/api/portal/intake']
const HIGH_TRAFFIC_READ_PREFIXES = ['/api/store/stream']

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

  // NextAuth internal routes — always pass through
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // ── API auth and rate limiting ─────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
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
  const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })

  if (!token && !PUBLIC_PAGES.has(pathname)) {
    return redirectTo('/login', request)
  }
  if (token && pathname === '/login') {
    return redirectTo('/', request)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest|sw\\.js|service-worker\\.js|offline\\.html|deed-logo.png|deed-logo.svg).*)'],
}
