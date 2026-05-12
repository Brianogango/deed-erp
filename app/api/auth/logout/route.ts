import { NextResponse } from 'next/server'

function sessionCookieName() {
  return 'deed-session'
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
