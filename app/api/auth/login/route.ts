import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'

import { getFirstAllowedModule } from '@/lib/auth/access'
import { verifyPassword } from '@/lib/auth/password'
import { findAuthUserByUsername, toPublicAuthUser, recordFailedLogin, clearFailedLogin } from '@/lib/auth/users-repository'
import { loginRatelimit } from '@/lib/rate-limit'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const SESSION_AGE = 12 * 60 * 60 // 12 hours in seconds
const USE_SECURE_COOKIES =
  process.env.NEXTAUTH_URL?.startsWith('https://') ||
  process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
  false

function sessionCookieName() {
  return 'deed-session'
}

export async function POST(request: NextRequest) {
  if (!SECRET) {
    return NextResponse.json({ message: 'Server misconfiguration: AUTH_SECRET not set' }, { status: 500 })
  }

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

  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) {
    const waitMinutes = Math.ceil((new Date(account.lockedUntil).getTime() - Date.now()) / 60000)
    return NextResponse.json(
      { message: `Account locked due to multiple failed login attempts. Try again in ${waitMinutes} minute(s).` },
      { status: 403 },
    )
  }

  const validPassword = await verifyPassword(password, account.passwordHash)

  if (!validPassword) {
    const lockoutStatus = await recordFailedLogin(account.id)
    if (lockoutStatus?.lockedUntil) {
      return NextResponse.json(
        { message: 'Too many failed attempts. Account locked for 15 minutes.' },
        { status: 403 },
      )
    }
    return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 })
  }

  if (account.failedLoginAttempts > 0 || account.lockedUntil) {
    await clearFailedLogin(account.id)
  }

  const user = toPublicAuthUser(account)

  // Issue a NextAuth-compatible JWT so getToken() and getServerSession() work everywhere.
  const jwt = await encode({
    token: {
      sub:       user.id,
      id:        user.id,
      name:      user.name,
      username:  user.username,
      role:      user.role,
      modules:   user.modules,
      active:    user.active,
      createdAt: user.createdAt,
    },
    secret:  SECRET,
    maxAge:  SESSION_AGE,
  })

  const response = NextResponse.json({
    user,
    defaultModule: getFirstAllowedModule(user),
    message: 'Login successful',
  })

  response.cookies.set(sessionCookieName(), jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   USE_SECURE_COOKIES,
    path:     '/',
    maxAge:   SESSION_AGE,
  })

  return response
}
