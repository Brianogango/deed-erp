import { NextRequest, NextResponse } from 'next/server'

import { challengeFromRequest, verifyMfaCode } from '@/lib/auth/mfa'
import { findAuthUserById, toPublicAuthUser } from '@/lib/auth/users-repository'
import { issueSessionResponse } from '@/lib/auth/session-issuer'
import { publishSessionStatus } from '@/lib/auth/session-validity'
import { checkRateLimit } from '@/lib/rate-limit'
import { InputSecurityError, readSafeJson } from '@/lib/input-security'

export async function POST(request: NextRequest) {
  const challenge = challengeFromRequest(request)
  if (!challenge) {
    return NextResponse.json({ message: 'MFA challenge expired. Sign in again.' }, { status: 401 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const rl = await checkRateLimit(`mfa-verify:${challenge.uid}:${ip}`, 10, 5 * 60)
  if (!rl.success) {
    return NextResponse.json({ message: 'Too many verification attempts. Sign in again later.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await readSafeJson(request, {
      maxBytes: 2_048,
      limits: { maxDepth: 4, maxNodes: 20, maxObjectKeys: 5, maxArrayLength: 0, maxStringLength: 64 },
    })
  } catch (error) {
    if (error instanceof InputSecurityError) {
      return NextResponse.json({ message: 'Invalid verification payload' }, { status: error.status })
    }
    throw error
  }

  const code = body && typeof body === 'object' && !Array.isArray(body)
    ? String((body as Record<string, unknown>).code || '')
    : ''

  const verified = await verifyMfaCode(challenge.uid, code, challenge.mode === 'enroll').catch(() => false)
  if (!verified) {
    return NextResponse.json({ message: 'Invalid or expired authenticator code.' }, { status: 401 })
  }

  const account = await findAuthUserById(challenge.uid)
  if (!account?.active) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  void publishSessionStatus(account.id, {
    isActive: true,
    role: account.role,
    actsAsTechnician: Boolean(account.actsAsTechnician),
    invalidatedAt: Date.now(),
  })

  const user = toPublicAuthUser(account)
  return issueSessionResponse(request, user, { mfaVerified: true, sessionVersion: account.sessionVersion })
}
