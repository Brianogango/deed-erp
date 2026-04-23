import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session'

const PUBLIC_PATHS         = ['/login', '/api/auth/login', '/api/auth/logout']
const PUBLIC_API_PATHS     = ['/api/auth/login', '/api/auth/logout']
const PUBLIC_PATH_PREFIXES = ['/track', '/api/portal/repair', '/api/portal/quotes']

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public portal paths
  if (PUBLIC_PATH_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }
  if (PUBLIC_API_PATHS.includes(pathname)) {
    return NextResponse.next()
  }

  // ── Rate limiting on all API routes ───────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const ip = getIP(request)
    // Dynamic import keeps Upstash out of the edge cold-start critical path
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
    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    // Auth check for protected API routes
    const session = await readSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return response
  }

  // ── Page auth ─────────────────────────────────────────────────────────────
  const token   = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null
  const session = await readSessionToken(token)
  const isPublicPath = PUBLIC_PATHS.includes(pathname)

  if (!session && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest).*)'],
}
