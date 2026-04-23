import { NextResponse } from 'next/server'

import { clearSessionCookie } from '@/lib/auth/server'

export async function POST() {
  const response = NextResponse.json({ message: 'Logged out' })
  return clearSessionCookie(response)
}
