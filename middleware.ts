import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { safeReturnTo } from '@/lib/auth/return-to'
import { assertSafeRequestEnvelope, assertSameOriginBrowserWrite, InputSecurityError } from '@/lib/input-security'
import { requiresPrivilegedMfa } from '@/lib/auth/mfa-policy'

export { safeReturnTo }
const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const COOKIE_NAME = 'deed-session'

// Paths that never require a session
const PUBLIC_PAGES        = new Set(['/login'])
// /api/setup-admin has no session to check against on a fresh DB — it enforces
// its own SETUP_ADMIN_SECRET header check and refuses to run once users exist.
const PUBLIC_API_PATHS    = new Set(['/api/auth/login', '/api/auth/logout', '/api/setup-admin', '/api/mpesa/callback', '/api/version'])
// sw.js and offline.html must be reachable without a session: the login page
// is where stale service workers get replaced, and a worker script that
// redirects to /login can never be updated by a signed-out browser.
const PUBLIC_ASSET_PATHS  = new Set([
  '/deed-logo.png', '/deed-logo.svg', '/deed-logo-receipt.png', '/deed-logo-sidebar.png', '/deed-icon.svg', '/login-bg.jpg', '/sw.js', '/deed-notifications-sw.js', '/offline.html', '/manifest.json',
  // Partner integration guide — shareable without an ERP login
  '/docs/partner-api-guide.html',
])
const PUBLIC_PATH_PREFIXES = [
  '/track',
  '/portal',
  '/api/portal/repair',
  '/api/portal/quotes',
  '/api/portal/intake',
  // Provider status callbacks authenticate themselves (Twilio signature, Telerivet secret, …).
  '/api/webhooks/notifications',
  // High-fidelity Sales UX review pack (demo data only — no production writes)
  '/sales-prototype',
]
const HIGH_TRAFFIC_READ_PREFIXES = ['/api/store/stream']

export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = {
  '/dashboard': '/',
  '/purchase': '/purchases',
  '/operations': '/inventory',
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

function redirectTo(path: string, req: NextRequest, returnTo?: string | null): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = path
  if (path === '/login') {
    url.search = ''
    if (returnTo) {
      const safe = safeReturnTo(returnTo)
      if (safe) url.searchParams.set('returnTo', safe)
    }
  }
  // Legacy aliases and other redirects keep the original query string.
  return NextResponse.redirect(url)
}

function isWriteMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function rateLimitPolicy(pathname: string, method: string): { limit: number; windowSec: number; bucket: string } {
  const e2eRelaxed = process.env.E2E_RELAX_RATE_LIMIT === '1'
  if (pathname === '/api/auth/login') return { limit: e2eRelaxed ? 120 : 10, windowSec: 60, bucket: 'login' }
  if (pathname === '/api/admin/reset' || pathname === '/api/admin/blob-cutover') return { limit: 3, windowSec: 60 * 60, bucket: 'critical-admin' }
  if (pathname.startsWith('/api/jarvis/chat')) return { limit: 20, windowSec: 60, bucket: 'jarvis-chat' }
  if (pathname.startsWith('/api/jarvis/ingest')) return { limit: 5, windowSec: 60 * 60, bucket: 'jarvis-ingest' }
  // Batched client syncs + dirty-key recovery can legitimately post several
  // times while a user opens modules; 20/min was forcing 429s and stalled UX.
  if (pathname === '/api/store' && isWriteMethod(method)) return { limit: 60, windowSec: 60, bucket: 'store-migration' }
  // EventSource reconnect storms used to 429 at 120/min and freeze sync.
  if (HIGH_TRAFFIC_READ_PREFIXES.some(prefix => pathname.startsWith(prefix))) return { limit: 360, windowSec: 60, bucket: 'store-stream' }
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

  // SEC-INPUT: every request surface is untrusted. Validate URL/query input and
  // inspect write bodies before public-route shortcuts, authentication, or any
  // business handler gets a chance to consume the payload.
  try {
    await assertSafeRequestEnvelope(request)
  } catch (error) {
    if (error instanceof InputSecurityError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw error
  }

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

  // Page-404 beacons carry only { path, status: 404 } — no session required.
  if (pathname === '/api/metrics/http' && request.method === 'POST') {
    const ip = getIP(request)
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const { success, remaining, resetAt } = await checkRateLimit(`metrics-404:${ip}`, 60, 60)
    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetAt),
        },
      })
    }
    return withRateLimitHeaders(NextResponse.next(), remaining, resetAt)
  }

  // Partner-facing public API (/api/public/*): no session cookie — the routes
  // authenticate with a partner API key themselves. Still rate-limited here,
  // per presented key (falling back to caller IP when no key is sent).
  if (pathname.startsWith('/api/public/')) {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const presentedKey = request.headers.get('x-api-key') ?? request.headers.get('authorization') ?? ''
    const limiterId = presentedKey ? presentedKey.slice(-24) : getIP(request)
    const isPublicImage =
      /\/api\/public\/v1\/products\/[^/]+\/images\/\d+$/.test(pathname)
      || /\/api\/public\/v1\/catalog-photos\/[^/]+\/\d+$/.test(pathname)
    const limit = isPublicImage ? 600 : 120
    const bucket = isPublicImage ? 'partner-images' : 'partner-api'
    const { success, remaining, resetAt } = await checkRateLimit(`${bucket}:${limiterId}`, limit, 60)
    if (!success) {
      return new NextResponse(JSON.stringify({ error: `Rate limit exceeded — max ${limit} requests per minute` }), {
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
    const isInternalBackfill =
      pathname === '/api/admin/backfill-repairs' ||
      pathname === '/api/admin/backfill-accounting'
    if (
      isInternalBackfill &&
      internalSecret &&
      request.headers.get('x-internal-secret') === internalSecret
    ) {
      return NextResponse.next()
    }

    // Cron jobs authenticate with CRON_SECRET; the route re-validates.
    const cronSecret = (process.env.CRON_SECRET || '').trim()
    if (pathname.startsWith('/api/cron/') && cronSecret) {
      const auth = (request.headers.get('authorization') || '').trim()
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
      const alt = (request.headers.get('x-cron-secret') || '').trim()
      const provided = bearer || alt
      if (provided && provided === cronSecret) {
        return NextResponse.next()
      }
    }

    const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authenticated browser mutations must originate from this ERP origin.
    // Public partner/webhook/portal routes are handled before this block and
    // keep their own authentication contracts.
    try {
      assertSameOriginBrowserWrite(request)
    } catch (error) {
      if (error instanceof InputSecurityError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      throw error
    }

    // SEC-002: deny JWT sessions revoked via the shared validity cache.
    // Cache miss fails open — getServerSession re-checks Postgres.
    const userId = typeof token.id === 'string' ? token.id : (typeof token.sub === 'string' ? token.sub : '')
    let requestHeaders: Headers | null = null
    let effectiveRole = typeof token.role === 'string' ? token.role : ''
    if (userId) {
      const { evaluateSessionAccess } = await import('@/lib/auth/session-validity')
      const access = await evaluateSessionAccess(userId, effectiveRole || null)
      if (!access.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (access.effectiveRole) {
        effectiveRole = access.effectiveRole
        requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-deed-effective-role', access.effectiveRole)
      }
    }

    if (requiresPrivilegedMfa(effectiveRole) && token.mfaVerified !== true) {
      return NextResponse.json(
        { error: 'MFA verification required', code: 'MFA_REQUIRED' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const { checkRateLimit } = await import('@/lib/rate-limit')
    const ip = getIP(request)
    const policy = rateLimitPolicy(pathname, request.method)
    const userKey = userId || ip
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

    const next = requestHeaders
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.next()
    return withRateLimitHeaders(next, remaining, resetAt)
  }

  // ── Page auth ─────────────────────────────────────────────────────────────
  // Local visual regression runs use the real app shell without a database.
  // Never honor this bypass in production, even if the variable is mis-set.
  const visregBypass =
    process.env.NODE_ENV !== 'production' &&
    process.env.VISREG_BYPASS_AUTH === 'true'
  if (visregBypass) {
    return NextResponse.next()
  }

  const token = SECRET ? await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME }) : null

  if (token) {
    const pageUserId = typeof token.id === 'string' ? token.id : (typeof token.sub === 'string' ? token.sub : '')
    let pageEffectiveRole = typeof token.role === 'string' ? token.role : ''
    if (pageUserId) {
      const { evaluateSessionAccess } = await import('@/lib/auth/session-validity')
      const access = await evaluateSessionAccess(pageUserId, pageEffectiveRole || null)
      if (!access.allowed) {
        const res = redirectTo('/login', request, `${pathname}${request.nextUrl.search}`)
        res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
        return res
      }
      if (access.effectiveRole) pageEffectiveRole = access.effectiveRole
    }

    if (requiresPrivilegedMfa(pageEffectiveRole) && token.mfaVerified !== true) {
      const res = redirectTo('/login', request, `${pathname}${request.nextUrl.search}`)
      res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 })
      return res
    }
  }

  if (!token && !PUBLIC_PAGES.has(pathname)) {
    return redirectTo('/login', request, `${pathname}${request.nextUrl.search}`)
  }
  if (token && pathname === '/login') {
    const dest = safeReturnTo(request.nextUrl.searchParams.get('returnTo')) || '/'
    const url = request.nextUrl.clone()
    if (dest.includes('?')) {
      const [p, qs] = dest.split('?')
      url.pathname = p
      url.search = qs ? `?${qs}` : ''
    } else {
      url.pathname = dest
      url.search = ''
    }
    return NextResponse.redirect(url)
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest|deed-logo.png|deed-logo.svg|deed-logo-receipt.png|deed-logo-sidebar.png|deed-icon.svg|login-bg.jpg).*)'],
}
