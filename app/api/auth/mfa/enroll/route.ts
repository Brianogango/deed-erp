import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

import { challengeFromRequest, prepareMfaEnrollment } from '@/lib/auth/mfa'
import { findAuthUserById } from '@/lib/auth/users-repository'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const challenge = challengeFromRequest(request)
  if (!challenge || challenge.mode !== 'enroll') {
    return NextResponse.json({ message: 'MFA enrollment challenge expired. Sign in again.' }, { status: 401 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const rl = await checkRateLimit(`mfa-enroll:${challenge.uid}:${ip}`, 5, 5 * 60)
  if (!rl.success) {
    return NextResponse.json({ message: 'Too many MFA enrollment attempts. Sign in again later.' }, { status: 429 })
  }

  const user = await findAuthUserById(challenge.uid)
  if (!user?.active) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const enrollment = await prepareMfaEnrollment(user.id, user.username)
    const qrDataUrl = await QRCode.toDataURL(enrollment.uri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256,
    })
    return NextResponse.json(
      {
        qrDataUrl,
        manualKey: enrollment.secret,
        message: 'Scan this code with your authenticator app, then enter the six-digit code.',
      },
      { headers: { 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    console.error('[auth/mfa/enroll] enrollment failed:', error instanceof Error ? error.message : 'unknown_error')
    return NextResponse.json({ message: 'MFA enrollment is not available. Contact an administrator.' }, { status: 503 })
  }
}
