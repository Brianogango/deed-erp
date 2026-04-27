import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This middleware protects your API routes from unauthorized access
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes (e.g., M-Pesa webhooks, login endpoints)
  const publicRoutes = ['/api/auth/login', '/api/mpesa/callback'];
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  // For all other /api routes, verify authentication
  if (pathname.startsWith('/api/')) {
    // TODO: Replace with actual session/JWT verification (e.g., NextAuth.js or Iron Session)
    const sessionCookie = request.cookies.get('deed_session_token');
    const authHeader = request.headers.get('authorization');

    if (!sessionCookie && !authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing session token' },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

// Configure which routes this middleware runs on
export const config = {
  matcher: ['/api/:path*'],
};