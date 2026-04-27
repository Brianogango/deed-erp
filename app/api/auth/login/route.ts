import { NextRequest, NextResponse } from 'next/server'

import { getFirstAllowedModule } from '@/lib/auth/access'
import { attachSessionCookie } from '@/lib/auth/server'
import { verifyPassword } from '@/lib/auth/password'
import { findAuthUserByUsername, toPublicAuthUser, recordFailedLogin, clearFailedLogin } from '@/lib/auth/users-repository'
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

  // Deny access immediately if the account is currently locked
  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) {
    const waitMinutes = Math.ceil((new Date(account.lockedUntil).getTime() - Date.now()) / 60000)
    return NextResponse.json({ message: `Account locked due to multiple failed login attempts. Try again in ${waitMinutes} minute(s).` }, { status: 403 })
  }

  const validPassword = await verifyPassword(password, account.passwordHash)

  if (!validPassword) {
    // Increment tracking count and lock if max limit is reached (default 5 attempts, 15 min lock)
    const lockoutStatus = await recordFailedLogin(account.id)
    if (lockoutStatus?.lockedUntil) {
      return NextResponse.json({ message: 'Too many failed attempts. Account locked for 15 minutes.' }, { status: 403 })
    }
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 })
  }

  // On successful login, clear any previous failed attempt trackers to reset the count
  if (account.failedLoginAttempts > 0 || account.lockedUntil) {
    await clearFailedLogin(account.id)
  }

  const user = toPublicAuthUser(account)
  const response = NextResponse.json({
    user,
    defaultModule: getFirstAllowedModule(user),
    message: 'Login successful',
  })

  return attachSessionCookie(response, user)
}
