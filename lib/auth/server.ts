import 'server-only'

import { NextResponse } from 'next/server'
import { getServerSession as nextAuthGetServerSession } from 'next-auth'

import { authOptions } from './auth-options'
import type { PublicUser, ServerSession, UserRole, ModuleId } from './types'
import { findAuthUserById } from './users-repository'

export const getServerSession = async (): Promise<ServerSession | null> => {
  const session = await nextAuthGetServerSession(authOptions)

  if (!session?.user?.id) return null

  // Security-sensitive session validation reads the user row directly.
  // This deliberately does not rely only on the middleware cache: password
  // changes increment session_version, so a JWT minted before that change must
  // fail even across separate Node/Edge processes or when Redis is unavailable.
  let liveUser
  try {
    liveUser = await findAuthUserById(session.user.id)
  } catch (error) {
    console.error('[auth/server] live session validation failed:', error instanceof Error ? error.message : 'unknown_error')
    return null
  }
  if (!liveUser?.active) return null

  const jwtSessionVersion = Math.max(0, Number(session.user.sessionVersion ?? 0) || 0)
  if (jwtSessionVersion < 1 || jwtSessionVersion !== Math.max(1, liveUser.sessionVersion)) return null

  const role = liveUser.role as UserRole

  const user: PublicUser = {
    id:        liveUser.id,
    username:  liveUser.username,
    name:      liveUser.name ?? '',
    role,
    modules:   Array.isArray(liveUser.modules) ? liveUser.modules as ModuleId[] : [],
    active:    true,
    createdAt: liveUser.createdAt,
    actsAsTechnician: Boolean(liveUser.actsAsTechnician),
  }

  return {
    user,
    issuedAt:  new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // approximated from maxAge
    expiresAt: session.expires,
  }
}

// clearSessionCookie is used by the logout route — clears the NextAuth cookie.
export const clearSessionCookie = (response: NextResponse) => {
  const cookieName = process.env.NODE_ENV === 'production'
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'

  response.cookies.set(cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   0,
    expires:  new Date(0),
  })

  return response
}

// attachSessionCookie is no longer used — the login route issues the JWT directly.
export const attachSessionCookie = (_response: NextResponse, _user: PublicUser) => _response
