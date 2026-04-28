import { NextResponse } from 'next/server'

function sessionCookieName() {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'
}

export async function POST() {
  const response = NextResponse.json({ message: 'Logged out' })
  response.cookies.set(sessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   0,
    expires:  new Date(0),
  })
  return response
}
