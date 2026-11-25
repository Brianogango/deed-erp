import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { clientIpOrNull } from '@/lib/client-ip'
import { clearPasskeyChallenge, findPasskey, markPasskeyUsed, readPasskeyChallenge } from '@/lib/auth/passkeys'
import { passkeyOrigins, passkeyRpId } from '@/lib/auth/passkey-core'
import { AttendanceError, clock, employeeForUser } from '@/lib/hr/attendance.server'

export const dynamic = 'force-dynamic'

/**
 * Clock in or out. The server's clock sets the time and the connection it
 * came in on says whether it was the office. A Face ID / fingerprint answer,
 * when sent, must be signed by one of this person's own passkeys.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as { action?: string; response?: { id?: unknown } }
    const action = body.action === 'out' ? 'out' : body.action === 'in' ? 'in' : null
    if (!action) throw new AttendanceError('Say whether this is a clock-in or clock-out')

    const employee = await employeeForUser(user)
    if (!employee) throw new AttendanceError('Your login is not linked to an employee record yet. Ask HR to link it.', 403)

    let verified = false
    if (body.response) {
      const challenge = readPasskeyChallenge(request, 'clock')
      if (!challenge || challenge.u !== user.id) throw new AttendanceError('That took too long. Try again.')
      const credentialId = typeof body.response.id === 'string' ? body.response.id : ''
      const passkey = credentialId ? await findPasskey(credentialId) : null
      if (!passkey || passkey.userId !== user.id) throw new AttendanceError('That Face ID / fingerprint belongs to another account', 403)
      try {
        const v = await verifyAuthenticationResponse({
          response: body.response as never,
          expectedChallenge: challenge.c,
          expectedOrigin: passkeyOrigins(request.headers),
          expectedRPID: passkeyRpId(request.headers),
          credential: { id: passkey.id, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports as never },
          requireUserVerification: true,
        })
        verified = v.verified
        if (verified) await markPasskeyUsed(passkey.id, v.authenticationInfo.newCounter)
      } catch (error) {
        console.warn('[attendance/clock] passkey rejected:', error instanceof Error ? error.message : error)
      }
      if (!verified) throw new AttendanceError('The Face ID / fingerprint check did not pass. Try again.', 401)
    }

    const day = await clock(employee.id, action, { ip: clientIpOrNull(request.headers), verified, actorName: user.name || user.username })
    return clearPasskeyChallenge(NextResponse.json({ day }), request, '/api/attendance')
  })
}
