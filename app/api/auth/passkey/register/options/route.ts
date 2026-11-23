import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { getServerSession } from '@/lib/auth/server'
import { findAuthUserById } from '@/lib/auth/users-repository'
import { verifyPassword } from '@/lib/auth/password'
import { listPasskeys, setPasskeyChallenge } from '@/lib/auth/passkeys'
import { passkeyRpId } from '@/lib/auth/passkey-core'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Start adding Face ID / fingerprint for the signed-in person. Their password
 * is asked again, so someone at an unlocked, signed-in phone cannot attach
 * their own face to this account.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ message: 'Sign in first' }, { status: 401 })

  const rl = await checkRateLimit(`passkey-register:${session.user.id}`, 10, 60 * 10)
  if (!rl.success) return NextResponse.json({ message: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })

  const body = await request.json().catch(() => ({})) as { password?: unknown }
  const account = await findAuthUserById(session.user.id)
  if (!account?.active) return NextResponse.json({ message: 'Sign in first' }, { status: 401 })
  const check = await verifyPassword(String(body.password ?? ''), account.passwordHash)
  if (!check.verified) return NextResponse.json({ message: 'That password is not right' }, { status: 403 })

  const existing = await listPasskeys(account.id)
  const options = await generateRegistrationOptions({
    rpName: 'Deed ERP',
    rpID: passkeyRpId(request.headers),
    userName: account.username,
    userDisplayName: account.name || account.username,
    userID: new TextEncoder().encode(account.id),
    attestationType: 'none',
    // Discoverable, so sign-in needs no username; the face or finger is required.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map(p => ({ id: p.id, transports: p.transports as never })),
  })

  const response = NextResponse.json({ options }, { headers: { 'Cache-Control': 'no-store' } })
  setPasskeyChallenge(response, request, { c: options.challenge, m: 'register', u: account.id })
  return response
}
