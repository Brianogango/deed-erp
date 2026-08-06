import { NextRequest, NextResponse } from 'next/server'
import { encode } from 'next-auth/jwt'
import { getFirstAllowedModule } from '@/lib/auth/access'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { findAuthUserByUsername, toPublicAuthUser, recordFailedLogin, clearFailedLogin, updateAuthUser } from '@/lib/auth/users-repository'
import { loginRatelimit } from '@/lib/rate-limit'
import { loginSchema, validate } from '@/lib/validation'
import { publishSessionStatus } from '@/lib/auth/session-validity'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
const SESSION_AGE = 12 * 60 * 60 // 12 hours

function shouldUseSecureCookie(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return (
    forwardedProto === 'https' ||
    request.nextUrl.protocol === 'https:' ||
    process.env.NEXTAUTH_URL?.startsWith('https://') ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ||
    false
  )
}

export async function POST(request: NextRequest) {
  if (!SECRET) {
    return NextResponse.json({ message: 'Server configuration error' }, { status: 500 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
  const rl = await loginRatelimit.limit(ip)
  if (!rl.success) {
    return NextResponse.json(
      { message: 'Too many attempts. Try again later.' },
      { status: 429 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 })
  }

  // Validate input using Zod
  let validated
  try {
    validated = await validate(loginSchema, body)
  } catch (err: any) {
    return NextResponse.json({ message: err.message }, { status: 400 })
  }

  const account = await findAuthUserByUsername(validated.username)
  if (!account || !account.active) {
    // Security: Use generic error message to prevent username enumeration
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 })
  }

  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) {
    return NextResponse.json({ message: 'Account locked. Try again later.' }, { status: 403 })
  }

  const passwordCheck = await verifyPassword(validated.password, account.passwordHash)
  if (!passwordCheck.verified) {
    await recordFailedLogin(account.id)
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 })
  }

  // Silently upgrade legacy SHA-256 hashes to bcrypt after a successful login (SEC-006).
  if (passwordCheck.needsRehash) {
    try {
      const upgradedHash = await hashPassword(validated.password)
      await updateAuthUser(account.id, {}, upgradedHash)
    } catch (err) {
      console.error('[auth/login] failed to upgrade legacy password hash:', err)
    }
  }

  await clearFailedLogin(account.id)
  const user = toPublicAuthUser(account)

  // Seed the validity cache so subsequent requests see a fresh active status.
  void publishSessionStatus(account.id, {
    isActive: true,
    role: account.role,
    invalidatedAt: Date.now(),
  })

  const jwt = await encode({
    token: {
      sub: user.id,
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      modules: user.modules,
      active: user.active,
      createdAt: user.createdAt,
      // Absolute session lifetime anchor (P0-DEED-001)
      sessionIssuedAt: new Date().toISOString(),
    },
    secret: SECRET,
    maxAge: SESSION_AGE,
  })

  const response = NextResponse.json({
    user,
    defaultModule: getFirstAllowedModule(user),
    message: 'Login successful',
  })

  response.cookies.set('deed-session', jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: SESSION_AGE,
  })

  return response
}
