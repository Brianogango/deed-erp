import { NextRequest, NextResponse } from 'next/server'

import { getFirstAllowedModule } from '@/lib/auth/access'
import { attachSessionCookie } from '@/lib/auth/server'
import { verifyPassword } from '@/lib/auth/password'
import { findAuthUserByUsername, toPublicAuthUser } from '@/lib/auth/users-repository'
import { loginRatelimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? '127.0.0.1'
  const rl = await loginRatelimit.limit(ip)
  if (!rl.success) {
    return NextResponse.json(
      { message: 'Too many login attempts. Please try again in a minute.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Invalid request payload' }, { status: 400 })
  }

  const username = typeof (body as { username?: unknown })?.username === 'string'
    ? (body as { username: string }).username.trim()
    : ''
  const password = typeof (body as { password?: unknown })?.password === 'string'
    ? (body as { password: string }).password
    : ''

  if (!username || !password) {
    return NextResponse.json({ message: 'Username and password are required' }, { status: 400 })
  }

  const account = await findAuthUserByUsername(username)

  if (!account?.active) {
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 })
  }

  const validPassword = await verifyPassword(password, account.passwordHash)

  if (!validPassword) {
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 })
  }

  const user = toPublicAuthUser(account)
  const response = NextResponse.json({
    user,
    defaultModule: getFirstAllowedModule(user),
    message: 'Login successful',
  })

  return attachSessionCookie(response, user)
}
