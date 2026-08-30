import 'server-only'

import { encode } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { getFirstAllowedModule } from '@/lib/auth/access'
import type { PublicUser } from '@/lib/auth/types'

const SESSION_AGE = 12 * 60 * 60
const COOKIE_NAME = 'deed-session'

function authSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
}

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

export async function issueSessionResponse(
  request: NextRequest,
  user: PublicUser,
  options: { mfaVerified?: boolean; sessionVersion?: number } = {},
) {
  const secret = authSecret()
  if (!secret) {
    return NextResponse.json({ message: 'Server configuration error' }, { status: 500 })
  }

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
      actsAsTechnician: Boolean(user.actsAsTechnician),
      sessionIssuedAt: new Date().toISOString(),
      mfaVerified: options.mfaVerified === true,
      sessionVersion: Math.max(1, Number(options.sessionVersion ?? 1) || 1),
    },
    secret,
    maxAge: SESSION_AGE,
  })

  const response = NextResponse.json({
    user,
    defaultModule: getFirstAllowedModule(user),
    message: 'Login successful',
  })

  response.cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: SESSION_AGE,
  })
  response.cookies.set('deed-mfa-challenge', '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookie(request),
    path: '/api/auth/mfa',
    maxAge: 0,
  })

  return response
}

export { shouldUseSecureCookie }
