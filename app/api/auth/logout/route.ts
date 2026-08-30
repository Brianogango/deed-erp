import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'

const USE_SECURE_COOKIES =
  process.env.NEXTAUTH_URL?.startsWith('https://') ||
  process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
  false

function sessionCookieName() {
  return 'deed-session'
}

export async function POST(request: NextRequest) {
  const rawSession = request.cookies.get(sessionCookieName())?.value || ''
  if (rawSession) {
    try {
      const tokenHash = crypto.createHash('sha256').update(rawSession).digest('hex')
      await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`
    } catch {
      // Best effort only. Clearing the HttpOnly cookie below is authoritative
      // for this browser even if the session index table is unavailable.
    }
  }

  const response = NextResponse.json({ message: 'Logged out' })
  response.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   USE_SECURE_COOKIES,
    path:     '/',
    maxAge:   0,
    expires:  new Date(0),
  })
  return response
}
