import 'server-only'

import { NextResponse } from 'next/server'
import { getServerSession as nextAuthGetServerSession } from 'next-auth'

import { authOptions } from './auth-options'
import type { PublicUser, ServerSession, UserRole, ModuleId } from './types'

export const getServerSession = async (): Promise<ServerSession | null> => {
  const session = await nextAuthGetServerSession(authOptions)

  if (!session?.user?.id) return null

  const user: PublicUser = {
    id:        session.user.id,
    username:  session.user.username,
    name:      session.user.name ?? '',
    role:      session.user.role as UserRole,
    modules:   session.user.modules as ModuleId[],
    active:    session.user.active,
    createdAt: session.user.createdAt,
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
