import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'deed-erp-demo-secret-2026'
const COOKIE_NAME = 'deed-session'

// Paths that never require a session
const PUBLIC_PAGES        = new Set(['/login'])
const PUBLIC_API_PATHS    = new Set(['/api/auth/login', '/api/auth/logout', '/api/setup-admin'])
const PUBLIC_PATH_PREFIXES = ['/track', '/portal', '/api/portal/repair', '/api/portal/quotes', '/api/portal/intake']

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // NextAuth internal routes — always pass through
  if (pathname.startsWith('/api/auth/') && !PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // Public portal / track paths
  if (PUBLIC_PATH_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Custom login / logout — always pass through
  if (PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // ── Rate limiting on all API routes ──────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const ip = getIP(request)
    const { checkRateLimit } = await import('@/lib/rate-limit')
    const isLogin = pathname === '/api/auth/login'
    const { success, remaining, resetAt } = await checkRateLimit(
      isLogin ? `login:${ip}` : `api:${ip}`,
      isLogin ? 10 : 120,
      60,
    )
    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
          'X-RateLimit-Remaining': '0',
        },
      })
    }

    // JWT auth for protected API routes
    const token = await getToken({ req: request, secret: SECRET, cookieName: COOKIE_NAME })
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    return response
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest).*)'],
}
