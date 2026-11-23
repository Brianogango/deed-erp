import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { setPasskeyChallenge } from '@/lib/auth/passkeys'
import { passkeyRpId } from '@/lib/auth/passkey-core'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIpFromHeaders } from '@/lib/client-ip'

export const dynamic = 'force-dynamic'

/** Start a Face ID / fingerprint sign-in. No username: the phone offers its passkey for this site. */
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers)
  const rl = await checkRateLimit(`passkey-login:${ip}`, process.env.E2E_RELAX_RATE_LIMIT === '1' ? 120 : 20, 60)
  if (!rl.success) return NextResponse.json({ message: 'Too many attempts. Try again later.' }, { status: 429 })

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId(request.headers),
    userVerification: 'required',
  })
  const response = NextResponse.json({ options }, { headers: { 'Cache-Control': 'no-store' } })
  setPasskeyChallenge(response, request, { c: options.challenge, m: 'login' })
  return response
}
