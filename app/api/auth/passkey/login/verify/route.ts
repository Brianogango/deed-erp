import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { findAuthUserById, toPublicAuthUser, clearFailedLogin } from '@/lib/auth/users-repository'
import { auditPasskey, clearPasskeyChallenge, findPasskey, markPasskeyUsed, readPasskeyChallenge } from '@/lib/auth/passkeys'
import { passkeyOrigins, passkeyRpId } from '@/lib/auth/passkey-core'
import { issueSessionResponse } from '@/lib/auth/session-issuer'
import { publishSessionStatus } from '@/lib/auth/session-validity'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIpFromHeaders } from '@/lib/client-ip'

export const dynamic = 'force-dynamic'

/**
 * Finish a Face ID / fingerprint sign-in. The phone checked the person (user
 * verification is required) and signed the challenge with a key only it
 * holds: that is two factors, so it stands in for the authenticator code.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers)
  const rl = await checkRateLimit(`passkey-login:${ip}`, process.env.E2E_RELAX_RATE_LIMIT === '1' ? 120 : 20, 60)
  const fail = (message: string, status = 401) => clearPasskeyChallenge(NextResponse.json({ message }, { status }), request)
  if (!rl.success) return fail('Too many attempts. Try again later.', 429)

  const challenge = readPasskeyChallenge(request, 'login')
  if (!challenge) return fail('That took too long. Try again.', 400)

  const body = await request.json().catch(() => ({})) as { response?: { id?: unknown } }
  const credentialId = typeof body.response?.id === 'string' ? body.response.id : ''
  if (!credentialId) return fail('Nothing came back from the phone', 400)

  const passkey = await findPasskey(credentialId)
  if (!passkey) return fail('This Face ID / fingerprint is not set up for the ERP. Sign in with your password, then add it in your account.')

  const account = await findAuthUserById(passkey.userId)
  if (!account || !account.active) return fail('This account is not active.')
  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) {
    return fail('Account locked. Try again later.', 403)
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: challenge.c,
      expectedOrigin: passkeyOrigins(request.headers),
      expectedRPID: passkeyRpId(request.headers),
      credential: { id: passkey.id, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports as never },
      requireUserVerification: true,
    })
  } catch (error) {
    console.warn('[passkey/login] rejected:', error instanceof Error ? error.message : error)
    return fail('The phone’s answer could not be checked. Try again or use your password.')
  }
  if (!verification.verified) return fail('The phone’s answer could not be checked. Try again or use your password.')

  await markPasskeyUsed(passkey.id, verification.authenticationInfo.newCounter)
  await clearFailedLogin(account.id)
  await auditPasskey('passkey.signin', account.id, account.id, { name: passkey.name, ip })
  void publishSessionStatus(account.id, {
    isActive: true,
    role: account.role,
    actsAsTechnician: Boolean(account.actsAsTechnician),
    invalidatedAt: Date.now(),
  })

  const response = await issueSessionResponse(request, toPublicAuthUser(account), {
    mfaVerified: true,
    sessionVersion: account.sessionVersion,
  })
  return clearPasskeyChallenge(response, request)
}
