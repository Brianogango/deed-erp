import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { findAuthUserByUsername, toPublicAuthUser, recordFailedLogin, clearFailedLogin, updateAuthUser } from '@/lib/auth/users-repository'
import { loginRatelimit } from '@/lib/rate-limit'
import { loginSchema, validate } from '@/lib/validation'
import { publishSessionStatus } from '@/lib/auth/session-validity'
import { getMfaState, mfaRequiredForRole, setMfaChallengeCookie } from '@/lib/auth/mfa'
import { issueSessionResponse } from '@/lib/auth/session-issuer'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''

export async function POST(request: NextRequest) {
  if (!SECRET) {
    return NextResponse.json({ message: 'Server configuration error' }, { status: 500 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
  const rl = await loginRatelimit.limit(ip)
  if (!rl.success) {
    return NextResponse.json(
      { message: 'Too many attempts. Try again later.' },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 })
  }

  let validated
  try {
    validated = await validate(loginSchema, body)
  } catch (err: any) {
    return NextResponse.json({ message: err.message }, { status: 400 })
  }

  const account = await findAuthUserByUsername(validated.username)
  if (!account || !account.active) {
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

  // Silently upgrade legacy SHA-256 hashes to bcrypt after a successful login.
  if (passwordCheck.needsRehash) {
    try {
      const upgradedHash = await hashPassword(validated.password)
      await updateAuthUser(account.id, {}, upgradedHash)
    } catch (err) {
      console.error('[auth/login] failed to upgrade legacy password hash:', err instanceof Error ? err.message : 'unknown_error')
    }
  }

  await clearFailedLogin(account.id)
  const user = toPublicAuthUser(account)

  // Privileged roles receive no ERP session after password verification. They
  // get a short-lived, HttpOnly MFA challenge and the full session is only
  // minted by /api/auth/mfa/verify after a valid TOTP.
  if (mfaRequiredForRole(account.role)) {
    try {
      const state = await getMfaState(account.id)
      const mode = state.enabled ? 'verify' : 'enroll'
      const response = NextResponse.json(
        {
          mfaRequired: true,
          mfaEnrollmentRequired: mode === 'enroll',
          message: mode === 'enroll'
            ? 'Authenticator setup is required for this privileged account.'
            : 'Enter the six-digit code from your authenticator app.',
        },
        { headers: { 'Cache-Control': 'no-store, private' } },
      )
      setMfaChallengeCookie(response, request, account.id, mode)
      return response
    } catch (error) {
      console.error('[auth/login] MFA initialization failed:', error instanceof Error ? error.message : 'unknown_error')
      return NextResponse.json({ message: 'Secure sign-in is temporarily unavailable.' }, { status: 503 })
    }
  }

  void publishSessionStatus(account.id, {
    isActive: true,
    role: account.role,
    actsAsTechnician: Boolean(account.actsAsTechnician),
    invalidatedAt: Date.now(),
  })

  return issueSessionResponse(request, user)
}
