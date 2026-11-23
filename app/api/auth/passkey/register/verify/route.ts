import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { getServerSession } from '@/lib/auth/server'
import { auditPasskey, clearPasskeyChallenge, readPasskeyChallenge, savePasskey } from '@/lib/auth/passkeys'
import { passkeyDeviceName, passkeyOrigins, passkeyRpId } from '@/lib/auth/passkey-core'

export const dynamic = 'force-dynamic'

/** Finish adding Face ID / fingerprint: check the phone's answer, keep its public key. */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ message: 'Sign in first' }, { status: 401 })

  const challenge = readPasskeyChallenge(request, 'register')
  const fail = (message: string, status = 400) => clearPasskeyChallenge(NextResponse.json({ message }, { status }), request)
  if (!challenge || challenge.u !== session.user.id) return fail('That took too long. Try adding it again.')

  const body = await request.json().catch(() => ({})) as { response?: unknown; name?: unknown }
  if (!body.response || typeof body.response !== 'object') return fail('Nothing came back from the phone')

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: challenge.c,
      expectedOrigin: passkeyOrigins(request.headers),
      expectedRPID: passkeyRpId(request.headers),
      requireUserVerification: true,
    })
  } catch (error) {
    console.warn('[passkey/register] rejected:', error instanceof Error ? error.message : error)
    return fail('The phone’s answer could not be checked. Try again.')
  }
  if (!verification.verified) return fail('The phone’s answer could not be checked. Try again.')

  const info = verification.registrationInfo
  const name = String(body.name ?? '').trim().slice(0, 60) || passkeyDeviceName(request.headers.get('user-agent'))
  try {
    await savePasskey({
      id: info.credential.id,
      userId: session.user.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      name,
    })
  } catch (error) {
    console.error('[passkey/register] save failed:', error instanceof Error ? error.message : error)
    return fail('This passkey is already on your account, or could not be saved.', 409)
  }
  await auditPasskey('passkey.added', session.user.id, session.user.id, { name, synced: info.credentialBackedUp })

  return clearPasskeyChallenge(NextResponse.json({ ok: true, name }), request)
}
