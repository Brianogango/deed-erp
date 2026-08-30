import 'server-only'

import crypto from 'node:crypto'
import { encode } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'
import { getFirstAllowedModule } from '@/lib/auth/access'
import type { PublicUser } from '@/lib/auth/types'
import { sql } from '@/lib/auth/db'

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

  const issuedAt = new Date()
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
      sessionIssuedAt: issuedAt.toISOString(),
      mfaVerified: options.mfaVerified === true,
      sessionVersion: Math.max(1, Number(options.sessionVersion ?? 1) || 1),
    },
    secret,
    maxAge: SESSION_AGE,
  })

  // Keep a revocable server-side session index without storing the JWT itself.
  // JWT authorization remains authoritative; this table powers the Security UI
  // and lets administrators identify active devices safely.
  try {
    const tokenHash = crypto.createHash('sha256').update(jwt).digest('hex')
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || null
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null
    const expiresAt = new Date(issuedAt.getTime() + SESSION_AGE * 1000)
    await sql`
      INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at, created_at)
      VALUES (${user.id}, ${tokenHash}, ${ipAddress}, ${userAgent}, ${expiresAt}, ${issuedAt})
      ON CONFLICT (token_hash) DO UPDATE SET
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        expires_at = EXCLUDED.expires_at
    `
  } catch (error) {
    console.warn('[auth/session] session index write skipped:', error instanceof Error ? error.message : 'unknown_error')
  }

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
