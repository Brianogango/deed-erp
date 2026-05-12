import { NextResponse } from 'next/server'

const USE_SECURE_COOKIES =
  process.env.NEXTAUTH_URL?.startsWith('https://') ||
  process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
  false

function sessionCookieName() {
  return 'deed-session'
}

export async function POST() {
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
