import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { listPasskeys, setPasskeyChallenge } from '@/lib/auth/passkeys'
import { passkeyRpId } from '@/lib/auth/passkey-core'

export const dynamic = 'force-dynamic'

/** Start the Face ID / fingerprint check for a clock-in or clock-out: only this person's own passkeys answer. */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const passkeys = await listPasskeys(user.id)
    if (!passkeys.length) return NextResponse.json({ options: null })
    const options = await generateAuthenticationOptions({
      rpID: passkeyRpId(request.headers),
      userVerification: 'required',
      allowCredentials: passkeys.map(p => ({ id: p.id, transports: p.transports as never })),
    })
    const response = NextResponse.json({ options }, { headers: { 'Cache-Control': 'no-store' } })
    setPasskeyChallenge(response, request, { c: options.challenge, m: 'clock', u: user.id }, '/api/attendance')
    return response
  })
}
